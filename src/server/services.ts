import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type {
  DetectedWorktreeService,
  RegisteredService,
  ServicePortStatus,
  ServiceProcessOwnership,
  ServiceSnapshot
} from "../shared/types";
import { mapWithConcurrency } from "./concurrency";

const execFileAsync = promisify(execFile);

type ActiveService = {
  child: ChildProcess;
  logPath: string;
};

export type ServiceManagerOptions = {
  logDir?: string;
  inspectPorts?: (ports: number[]) => Promise<ServicePortStatus[]>;
  inspectListeners?: () => Promise<ServicePortStatus[]>;
  inspectProcessTree?: (pid: number) => Promise<ServiceProcessTreeEntry[]>;
  checkHealth?: (url: string) => Promise<boolean>;
  terminatePid?: (pid: number) => Promise<void>;
  readLogPreview?: (projectId: string, serviceId: string) => Promise<string[]>;
};

type ServiceProcessTreeEntry = {
  pid: number;
  parentPid: number | null;
  name: string | null;
  cwd: string | null;
  executablePath: string | null;
  commandLine: string | null;
};

type OwnershipMarker = {
  label: "project path" | "service directory" | "linked worktree";
  value: string;
};

type WorktreeServiceTarget = {
  path: string;
  branch: string | null;
};

type ListeningProcess = {
  pid: number;
  ports: number[];
  processTree: ServiceProcessTreeEntry[];
};

export class ServiceManager {
  private readonly active = new Map<string, ActiveService>();
  private readonly logDir: string;
  private readonly inspectPortsImpl: (ports: number[]) => Promise<ServicePortStatus[]>;
  private readonly inspectListenersImpl: () => Promise<ServicePortStatus[]>;
  private readonly inspectProcessTreeImpl: (pid: number) => Promise<ServiceProcessTreeEntry[]>;
  private readonly inspectProcessTreesImpl: (pids: number[]) => Promise<Map<number, ServiceProcessTreeEntry[]>>;
  private readonly checkHealthImpl: (url: string) => Promise<boolean>;
  private readonly terminatePidImpl: (pid: number) => Promise<void>;
  private readonly readLogPreviewImpl?: (projectId: string, serviceId: string) => Promise<string[]>;
  private listenerScanCache: { expiresAt: number; promise: Promise<ListeningProcess[]> } | null = null;

  constructor(options: ServiceManagerOptions = {}) {
    this.logDir = options.logDir ?? join(process.cwd(), "work", "service-logs");
    this.inspectPortsImpl = options.inspectPorts ?? inspectPorts;
    this.inspectListenersImpl = options.inspectListeners ?? inspectListeningPorts;
    this.inspectProcessTreeImpl = options.inspectProcessTree ?? inspectProcessTree;
    this.inspectProcessTreesImpl = options.inspectProcessTree
      ? async (pids) => {
          const trees = await mapWithConcurrency(pids, 4, async (pid) => [pid, await options.inspectProcessTree!(pid)] as const);
          return new Map(trees);
        }
      : inspectProcessTrees;
    this.checkHealthImpl = options.checkHealth ?? checkHealth;
    this.terminatePidImpl = options.terminatePid ?? terminatePid;
    this.readLogPreviewImpl = options.readLogPreview;
  }

  async snapshot(
    projectId: string,
    service: RegisteredService,
    projectPath = service.cwd,
    worktreePaths: string[] = []
  ): Promise<ServiceSnapshot> {
    const key = serviceKey(projectId, service.id);
    const active = this.active.get(key);
    const isOwnedProcessRunning = !!active?.child.pid && active.child.exitCode === null && !active.child.killed;
    const portsStatus = await this.inspectPortsImpl(service.ports);
    const healthOk = service.healthUrl ? await this.checkHealthImpl(service.healthUrl).catch(() => false) : null;
    const occupiedPort = portsStatus.find((port) => port.listening);
    const status = serviceStatus({
      healthOk,
      isOwnedProcessRunning,
      occupiedPort: !!occupiedPort
    });
    const ownership = await this.resolveProcessOwnership({
      isOwnedProcessRunning,
      portsStatus,
      projectPath,
      worktreePaths,
      service,
      status
    });

    return {
      ...service,
      status,
      startedByConsole: isOwnedProcessRunning,
      pid: isOwnedProcessRunning ? active?.child.pid ?? null : occupiedPort?.pid ?? null,
      processCwd: ownership.processCwd,
      processOwnership: ownership.ownership,
      processOwnerHint: ownership.hint,
      portsStatus,
      logPreview: await this.logs(projectId, service.id)
    };
  }

  async start(projectId: string, service: RegisteredService): Promise<ServiceSnapshot> {
    const current = await this.snapshot(projectId, service);
    if (current.startedByConsole) {
      return current;
    }
    if (current.status === "port-occupied") {
      throw new Error(`Port is already occupied for ${service.name}.`);
    }

    await mkdir(this.logDir, { recursive: true });
    const logPath = this.logPath(projectId, service.id);
    const logStream = createWriteStream(logPath, { flags: "a" });
    logStream.write(`\n[${new Date().toISOString()}] $ ${service.command}\n`);

    const child = spawn(service.command, {
      cwd: service.cwd,
      detached: false,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });
    child.once("exit", (code, signal) => {
      logStream.write(`\n[${new Date().toISOString()}] exited code=${code ?? "null"} signal=${signal ?? "null"}\n`);
      logStream.end();
      this.active.delete(serviceKey(projectId, service.id));
    });

    this.active.set(serviceKey(projectId, service.id), { child, logPath });
    return this.snapshot(projectId, service);
  }

  async stop(
    projectId: string,
    service: RegisteredService,
    projectPath = service.cwd,
    worktreePaths: string[] = []
  ): Promise<ServiceSnapshot> {
    const key = serviceKey(projectId, service.id);
    const active = this.active.get(key);
    const current = await this.snapshot(projectId, service, projectPath, worktreePaths);

    if (current.startedByConsole) {
      if (!active?.child.pid || active.child.exitCode !== null || active.child.killed) {
        throw new Error(`${service.name} was not started by this console.`);
      }

      await this.terminatePidImpl(active.child.pid);
      this.active.delete(key);
      return this.snapshot(projectId, service, projectPath, worktreePaths);
    }

    const pids = listeningPids(current.portsStatus);
    if (pids.length === 0) {
      throw new Error("External process PID could not be detected for this service.");
    }
    if (current.processOwnership !== "project") {
      throw new Error("External process is not recognized as part of this project.");
    }
    if (pids.includes(process.pid)) {
      throw new Error("Refusing to stop the Worktree Console server process.");
    }

    for (const pid of pids) {
      await this.terminatePidImpl(pid);
    }
    return this.snapshot(projectId, service, projectPath, worktreePaths);
  }

  async restart(
    projectId: string,
    service: RegisteredService,
    projectPath = service.cwd,
    worktreePaths: string[] = []
  ): Promise<ServiceSnapshot> {
    const key = serviceKey(projectId, service.id);
    if (this.active.has(key)) {
      await this.stop(projectId, service, projectPath, worktreePaths);
    }
    return this.start(projectId, service);
  }

  async logs(projectId: string, serviceId: string): Promise<string[]> {
    if (this.readLogPreviewImpl) {
      return this.readLogPreviewImpl(projectId, serviceId);
    }
    return readLogTail(this.logPath(projectId, serviceId), 80);
  }

  async discoverWorktreeServices(
    worktrees: WorktreeServiceTarget[],
    registeredServices: ServiceSnapshot[]
  ): Promise<DetectedWorktreeService[]> {
    if (worktrees.length === 0) return [];

    const registeredPorts = new Set(registeredServices.flatMap((service) => service.ports));
    const listeningProcesses = await this.scanListeningProcesses();

    return listeningProcesses
      .filter((processInfo) => !processInfo.ports.some((port) => registeredPorts.has(port)))
      .map((processInfo) => {
        const worktree = matchingWorktree(processInfo.processTree, worktrees);
        if (!worktree) return null;
        const processEntry = processInfo.processTree[0];
        return {
          id: `detected-${processInfo.pid}`,
          worktreePath: worktree.path,
          branch: worktree.branch,
          pid: processInfo.pid,
          processName: processEntry?.name ?? null,
          processCwd: processEntry?.cwd ?? null,
          ports: processInfo.ports
        } satisfies DetectedWorktreeService;
      })
      .filter((service): service is DetectedWorktreeService => service !== null)
      .sort((left, right) => left.ports[0] - right.ports[0] || left.pid - right.pid);
  }

  private logPath(projectId: string, serviceId: string) {
    return join(this.logDir, `${safeName(projectId)}-${safeName(serviceId)}.log`);
  }

  private async scanListeningProcesses(): Promise<ListeningProcess[]> {
    const now = Date.now();
    if (this.listenerScanCache && this.listenerScanCache.expiresAt > now) {
      return this.listenerScanCache.promise;
    }

    const promise = this.inspectListenersImpl().then(async (listeners) => {
      const portsByPid = new Map<number, Set<number>>();
      for (const listener of listeners) {
        if (!listener.listening || !listener.pid || listener.pid === process.pid) continue;
        const ports = portsByPid.get(listener.pid) ?? new Set<number>();
        ports.add(listener.port);
        portsByPid.set(listener.pid, ports);
      }

      const entries = Array.from(portsByPid.entries());
      const processTrees = await this.inspectProcessTreesImpl(entries.map(([pid]) => pid));
      return entries.map(([pid, ports]) => ({
        pid,
        ports: Array.from(ports).sort((left, right) => left - right),
        processTree: processTrees.get(pid) ?? []
      }));
    });

    this.listenerScanCache = { expiresAt: now + 2_000, promise };
    try {
      return await promise;
    } catch (error) {
      if (this.listenerScanCache?.promise === promise) this.listenerScanCache = null;
      throw error;
    }
  }

  private async resolveProcessOwnership({
    isOwnedProcessRunning,
    portsStatus,
    projectPath,
    worktreePaths,
    service,
    status
  }: {
    isOwnedProcessRunning: boolean;
    portsStatus: ServicePortStatus[];
    projectPath: string;
    worktreePaths: string[];
    service: RegisteredService;
    status: ServiceSnapshot["status"];
  }): Promise<{ ownership: ServiceProcessOwnership; hint: string | null; processCwd: string | null }> {
    if (isOwnedProcessRunning) {
      return { ownership: "console", hint: "Started by this console.", processCwd: service.cwd };
    }
    if (status === "stopped") {
      return { ownership: "none", hint: null, processCwd: null };
    }

    const pids = listeningPids(portsStatus);
    if (pids.length === 0) {
      return { ownership: "unknown", hint: null, processCwd: null };
    }

    const markers = ownershipMarkers(projectPath, service.cwd, worktreePaths);
    if (markers.length === 0) {
      return { ownership: "unknown", hint: null, processCwd: null };
    }

    let matchedMarker: OwnershipMarker | null = null;
    let processCwd: string | null = null;
    for (const pid of pids) {
      const processTree = await this.inspectProcessTreeImpl(pid).catch(() => []);
      processCwd ??= processTree[0]?.cwd ?? null;
      const marker = matchingOwnershipMarker(processTree, markers);
      if (!marker) {
        return { ownership: "unknown", hint: null, processCwd };
      }
      matchedMarker ??= marker;
    }

    return {
      ownership: "project",
      hint: matchedMarker ? `Matched ${matchedMarker.label} in process tree.` : null,
      processCwd
    };
  }
}

function serviceStatus({
  healthOk,
  isOwnedProcessRunning,
  occupiedPort
}: {
  healthOk: boolean | null;
  isOwnedProcessRunning: boolean;
  occupiedPort: boolean;
}): ServiceSnapshot["status"] {
  if (isOwnedProcessRunning) {
    return healthOk === false ? "starting" : "running";
  }
  if (healthOk === true) {
    return "running";
  }
  if (occupiedPort) {
    return "port-occupied";
  }
  return "stopped";
}

async function inspectPorts(ports: number[]): Promise<ServicePortStatus[]> {
  if (ports.length === 0) {
    return [];
  }

  const base = ports.map((port) => ({
    port,
    listening: false,
    pid: null,
    processName: null
  }));

  try {
    const output = await inspectListeningPorts();
    return base.map((candidate) => output.find((entry) => entry.port === candidate.port) ?? candidate);
  } catch {
    return base;
  }
}

async function inspectListeningPorts(): Promise<ServicePortStatus[]> {
  return process.platform === "win32" ? windowsNetstat() : unixListeningPorts();
}

async function windowsNetstat(): Promise<ServicePortStatus[]> {
  const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], { windowsHide: true });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("TCP"))
    .map((line) => line.split(/\s+/))
    .filter((columns) => columns.length >= 5 && columns[3] === "LISTENING")
    .map((columns) => ({
      port: Number(columns[1].slice(columns[1].lastIndexOf(":") + 1)),
      listening: true,
      pid: Number(columns[4]) || null,
      processName: null
    }))
    .filter((entry) => Number.isInteger(entry.port));
}

async function unixListeningPorts(): Promise<ServicePortStatus[]> {
  const { stdout } = await execFileAsync("sh", ["-c", "lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null || true"]);
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns.length >= 9)
    .map((columns) => ({
      port: Number(columns[8].slice(columns[8].lastIndexOf(":") + 1)),
      listening: true,
      pid: Number(columns[1]) || null,
      processName: columns[0] || null
    }))
    .filter((entry) => Number.isInteger(entry.port));
}

async function inspectProcessTree(pid: number): Promise<ServiceProcessTreeEntry[]> {
  if (process.platform === "win32") {
    return windowsProcessTree(pid);
  }
  return unixProcessTree(pid);
}

async function inspectProcessTrees(pids: number[]): Promise<Map<number, ServiceProcessTreeEntry[]>> {
  if (process.platform === "win32") {
    return windowsProcessTrees(pids);
  }

  const entries = await mapWithConcurrency(pids, 4, async (pid) => [pid, await unixProcessTree(pid).catch(() => [])] as const);
  return new Map(entries);
}

async function windowsProcessTree(pid: number): Promise<ServiceProcessTreeEntry[]> {
  return (await windowsProcessTrees([pid])).get(pid) ?? [];
}

async function windowsProcessTrees(pids: number[]): Promise<Map<number, ServiceProcessTreeEntry[]>> {
  const targets = Array.from(new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0)));
  if (targets.length === 0) return new Map();
  const script = `
$targetPids = @(${targets.join(",")})
$processById = @{}
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $processById[[int]$_.ProcessId] = $_
}
$results = @()
foreach ($targetPid in $targetPids) {
  $items = @()
  $pidValue = [int]$targetPid
  for ($i = 0; $i -lt 8 -and $pidValue -gt 0; $i++) {
    $processInfo = $processById[$pidValue]
    if (-not $processInfo) { break }
    $items += [pscustomobject]@{
      pid = [int]$processInfo.ProcessId
      parentPid = [int]$processInfo.ParentProcessId
      name = $processInfo.Name
      executablePath = $processInfo.ExecutablePath
      commandLine = $processInfo.CommandLine
    }
    $pidValue = [int]$processInfo.ParentProcessId
  }
  $results += [pscustomobject]@{ targetPid = [int]$targetPid; entries = $items }
}
$results | ConvertTo-Json -Depth 6 -Compress
`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true, timeout: 3000 }
  );
  const rows = parseJsonRows(stdout);
  const cwdByPid = await windowsProcessCwds(targets).catch(() => new Map<number, string>());
  const trees = new Map<number, ServiceProcessTreeEntry[]>();
  for (const row of rows) {
    const targetPid = Number(row.targetPid);
    if (!targetPid) continue;
    const tree = parseProcessTreeRows(row.entries);
    if (tree[0]) tree[0].cwd = cwdByPid.get(targetPid) ?? null;
    trees.set(targetPid, tree);
  }
  return trees;
}

async function unixProcessTree(pid: number): Promise<ServiceProcessTreeEntry[]> {
  const tree: ServiceProcessTreeEntry[] = [];
  let currentPid = pid;

  for (let index = 0; index < 8 && currentPid > 0; index += 1) {
    const { stdout } = await execFileAsync("ps", ["-o", "pid=,ppid=,comm=,args=", "-p", String(currentPid)], {
      timeout: 3000
    });
    const line = stdout.trim();
    const match = /^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!match) break;

    const [, rawPid, rawParentPid, name, commandLine] = match;
    const parentPid = Number(rawParentPid);
    tree.push({
      pid: Number(rawPid),
      parentPid,
      name,
      cwd: index === 0 ? await readProcessCwd(Number(rawPid)).catch(() => null) : null,
      executablePath: null,
      commandLine: commandLine || null
    });
    currentPid = parentPid;
  }

  return tree;
}

async function checkHealth(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}

async function terminatePid(pid: number): Promise<void> {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
    return;
  }

  process.kill(pid, "SIGTERM");
}

async function readLogTail(path: string, maxLines: number): Promise<string[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function serviceKey(projectId: string, serviceId: string) {
  return `${projectId}:${serviceId}`;
}

function listeningPids(portsStatus: ServicePortStatus[]): number[] {
  return Array.from(
    new Set(
      portsStatus
        .filter((port) => port.listening && Number.isInteger(port.pid) && (port.pid ?? 0) > 0)
        .map((port) => port.pid as number)
    )
  );
}

function ownershipMarkers(projectPath: string, serviceCwd: string, worktreePaths: string[]): OwnershipMarker[] {
  const markers: OwnershipMarker[] = [];
  addOwnershipMarker(markers, "project path", projectPath);
  addOwnershipMarker(markers, "service directory", serviceCwd);
  for (const worktreePath of worktreePaths) {
    addOwnershipMarker(markers, "linked worktree", worktreePath);
  }
  return markers;
}

function addOwnershipMarker(markers: OwnershipMarker[], label: OwnershipMarker["label"], rawPath: string) {
  const marker = normalizePathForMatch(rawPath);
  if (!marker || markers.some((candidate) => candidate.value === marker)) {
    return;
  }
  markers.push({ label, value: marker });
}

function matchingOwnershipMarker(
  processTree: ServiceProcessTreeEntry[],
  markers: OwnershipMarker[]
): OwnershipMarker | null {
  const haystack = normalizeTextForPathMatch(
    processTree
      .flatMap((entry) => [entry.cwd, entry.executablePath, entry.commandLine])
      .filter((value): value is string => Boolean(value))
      .join("\n")
  );

  return markers.find((marker) => haystack.includes(marker.value)) ?? null;
}

function matchingWorktree(
  processTree: ServiceProcessTreeEntry[],
  worktrees: WorktreeServiceTarget[]
): WorktreeServiceTarget | null {
  const candidates = worktrees
    .map((worktree) => ({ worktree, marker: normalizePathForMatch(worktree.path) }))
    .filter((candidate): candidate is { worktree: WorktreeServiceTarget; marker: string } => Boolean(candidate.marker))
    .sort((left, right) => right.marker.length - left.marker.length);
  const processCwd = normalizePathForMatch(processTree[0]?.cwd ?? "");

  if (processCwd) {
    const cwdMatch = candidates.find(
      (candidate) => processCwd === candidate.marker || processCwd.startsWith(`${candidate.marker}/`)
    );
    if (cwdMatch) return cwdMatch.worktree;
  }
  return null;
}

function normalizePathForMatch(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeTextForPathMatch(trimmed).replace(/\/+$/, "");
  if (normalized.length < 4 || !normalized.includes("/")) {
    return null;
  }
  return normalized;
}

function normalizeTextForPathMatch(value: string): string {
  return value.replace(/\\/g, "/").replace(/"/g, "").toLowerCase();
}

function parseProcessTreeJson(raw: string): ServiceProcessTreeEntry[] {
  return parseProcessTreeRows(JSON.parse(raw.trim()));
}

function parseProcessTreeRows(parsed: unknown): ServiceProcessTreeEntry[] {
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      pid: Number(row.pid) || 0,
      parentPid: Number(row.parentPid) || null,
      name: typeof row.name === "string" ? row.name : null,
      cwd: typeof row.cwd === "string" ? row.cwd : null,
      executablePath: typeof row.executablePath === "string" ? row.executablePath : null,
      commandLine: typeof row.commandLine === "string" ? row.commandLine : null
    }))
    .filter((entry) => entry.pid > 0);
}

function parseJsonRows(raw: string): Record<string, unknown>[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parsed: unknown = JSON.parse(trimmed);
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"
  );
}

async function readProcessCwd(pid: number): Promise<string | null> {
  if (!pid) return null;
  if (process.platform === "win32") {
    return windowsProcessCwd(pid);
  }

  const cwd = await readlink(`/proc/${pid}/cwd`);
  return cwd || null;
}

async function windowsProcessCwd(pid: number): Promise<string | null> {
  return (await windowsProcessCwds([pid])).get(pid) ?? null;
}

async function windowsProcessCwds(pids: number[]): Promise<Map<number, string>> {
  const script = [
    "import json, sys",
    "result = {}",
    "try:",
    "    import psutil",
    "except Exception:",
    "    print('{}')",
    "    raise SystemExit(0)",
    "for raw_pid in sys.argv[1:]:",
    "    try:",
    "        result[raw_pid] = psutil.Process(int(raw_pid)).cwd()",
    "    except Exception:",
    "        pass",
    "print(json.dumps(result))"
  ].join("\n");
  const { stdout } = await execFileAsync("python", ["-c", script, ...pids.map(String)], {
    windowsHide: true,
    timeout: 2_000
  });
  const trimmed = stdout.trim();
  if (!trimmed) return new Map();
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
  return new Map(
    Object.entries(parsed)
      .map(([rawPid, cwd]) => [Number(rawPid), cwd] as const)
      .filter((entry): entry is readonly [number, string] => Number.isInteger(entry[0]) && typeof entry[1] === "string")
  );
}
