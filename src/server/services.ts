import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { RegisteredService, ServicePortStatus, ServiceProcessOwnership, ServiceSnapshot } from "../shared/types";

const execFileAsync = promisify(execFile);

type ActiveService = {
  child: ChildProcess;
  logPath: string;
};

export type ServiceManagerOptions = {
  logDir?: string;
  inspectPorts?: (ports: number[]) => Promise<ServicePortStatus[]>;
  inspectProcessTree?: (pid: number) => Promise<ServiceProcessTreeEntry[]>;
  checkHealth?: (url: string) => Promise<boolean>;
  terminatePid?: (pid: number) => Promise<void>;
  readLogPreview?: (projectId: string, serviceId: string) => Promise<string[]>;
};

type ServiceProcessTreeEntry = {
  pid: number;
  parentPid: number | null;
  name: string | null;
  executablePath: string | null;
  commandLine: string | null;
};

type OwnershipMarker = {
  label: "project path" | "service directory";
  value: string;
};

export class ServiceManager {
  private readonly active = new Map<string, ActiveService>();
  private readonly logDir: string;
  private readonly inspectPortsImpl: (ports: number[]) => Promise<ServicePortStatus[]>;
  private readonly inspectProcessTreeImpl: (pid: number) => Promise<ServiceProcessTreeEntry[]>;
  private readonly checkHealthImpl: (url: string) => Promise<boolean>;
  private readonly terminatePidImpl: (pid: number) => Promise<void>;
  private readonly readLogPreviewImpl?: (projectId: string, serviceId: string) => Promise<string[]>;

  constructor(options: ServiceManagerOptions = {}) {
    this.logDir = options.logDir ?? join(process.cwd(), "work", "service-logs");
    this.inspectPortsImpl = options.inspectPorts ?? inspectPorts;
    this.inspectProcessTreeImpl = options.inspectProcessTree ?? inspectProcessTree;
    this.checkHealthImpl = options.checkHealth ?? checkHealth;
    this.terminatePidImpl = options.terminatePid ?? terminatePid;
    this.readLogPreviewImpl = options.readLogPreview;
  }

  async snapshot(projectId: string, service: RegisteredService, projectPath = service.cwd): Promise<ServiceSnapshot> {
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
      service,
      status
    });

    return {
      ...service,
      status,
      startedByConsole: isOwnedProcessRunning,
      pid: isOwnedProcessRunning ? active?.child.pid ?? null : occupiedPort?.pid ?? null,
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

  async stop(projectId: string, service: RegisteredService, projectPath = service.cwd): Promise<ServiceSnapshot> {
    const key = serviceKey(projectId, service.id);
    const active = this.active.get(key);
    const current = await this.snapshot(projectId, service, projectPath);

    if (current.startedByConsole) {
      if (!active?.child.pid || active.child.exitCode !== null || active.child.killed) {
        throw new Error(`${service.name} was not started by this console.`);
      }

      await this.terminatePidImpl(active.child.pid);
      this.active.delete(key);
      return this.snapshot(projectId, service, projectPath);
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
    return this.snapshot(projectId, service, projectPath);
  }

  async restart(projectId: string, service: RegisteredService, projectPath = service.cwd): Promise<ServiceSnapshot> {
    const key = serviceKey(projectId, service.id);
    if (this.active.has(key)) {
      await this.stop(projectId, service, projectPath);
    }
    return this.start(projectId, service);
  }

  async logs(projectId: string, serviceId: string): Promise<string[]> {
    if (this.readLogPreviewImpl) {
      return this.readLogPreviewImpl(projectId, serviceId);
    }
    return readLogTail(this.logPath(projectId, serviceId), 80);
  }

  private logPath(projectId: string, serviceId: string) {
    return join(this.logDir, `${safeName(projectId)}-${safeName(serviceId)}.log`);
  }

  private async resolveProcessOwnership({
    isOwnedProcessRunning,
    portsStatus,
    projectPath,
    service,
    status
  }: {
    isOwnedProcessRunning: boolean;
    portsStatus: ServicePortStatus[];
    projectPath: string;
    service: RegisteredService;
    status: ServiceSnapshot["status"];
  }): Promise<{ ownership: ServiceProcessOwnership; hint: string | null }> {
    if (isOwnedProcessRunning) {
      return { ownership: "console", hint: "Started by this console." };
    }
    if (status === "stopped") {
      return { ownership: "none", hint: null };
    }

    const pids = listeningPids(portsStatus);
    if (pids.length === 0) {
      return { ownership: "unknown", hint: null };
    }

    const markers = ownershipMarkers(projectPath, service.cwd);
    if (markers.length === 0) {
      return { ownership: "unknown", hint: null };
    }

    let matchedMarker: OwnershipMarker | null = null;
    for (const pid of pids) {
      const processTree = await this.inspectProcessTreeImpl(pid).catch(() => []);
      const marker = matchingOwnershipMarker(processTree, markers);
      if (!marker) {
        return { ownership: "unknown", hint: null };
      }
      matchedMarker ??= marker;
    }

    return {
      ownership: "project",
      hint: matchedMarker ? `Matched ${matchedMarker.label} in process tree.` : null
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
    const output = process.platform === "win32" ? await windowsNetstat() : await unixListeningPorts();
    return base.map((candidate) => output.find((entry) => entry.port === candidate.port) ?? candidate);
  } catch {
    return base;
  }
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

async function windowsProcessTree(pid: number): Promise<ServiceProcessTreeEntry[]> {
  const script = `
$items = @()
$pidValue = ${Number(pid)}
for ($i = 0; $i -lt 8 -and $pidValue -gt 0; $i++) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
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
$items | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true, timeout: 3000 }
  );
  return parseProcessTreeJson(stdout);
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

function ownershipMarkers(projectPath: string, serviceCwd: string): OwnershipMarker[] {
  const markers: OwnershipMarker[] = [];
  addOwnershipMarker(markers, "project path", projectPath);
  addOwnershipMarker(markers, "service directory", serviceCwd);
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
      .flatMap((entry) => [entry.executablePath, entry.commandLine])
      .filter((value): value is string => Boolean(value))
      .join("\n")
  );

  return markers.find((marker) => haystack.includes(marker.value)) ?? null;
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
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  const parsed: unknown = JSON.parse(trimmed);
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      pid: Number(row.pid) || 0,
      parentPid: Number(row.parentPid) || null,
      name: typeof row.name === "string" ? row.name : null,
      executablePath: typeof row.executablePath === "string" ? row.executablePath : null,
      commandLine: typeof row.commandLine === "string" ? row.commandLine : null
    }))
    .filter((entry) => entry.pid > 0);
}
