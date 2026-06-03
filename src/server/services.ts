import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { RegisteredService, ServicePortStatus, ServiceSnapshot } from "../shared/types";

const execFileAsync = promisify(execFile);

type ActiveService = {
  child: ChildProcess;
  logPath: string;
};

export type ServiceManagerOptions = {
  logDir?: string;
  inspectPorts?: (ports: number[]) => Promise<ServicePortStatus[]>;
  checkHealth?: (url: string) => Promise<boolean>;
  readLogPreview?: (projectId: string, serviceId: string) => Promise<string[]>;
};

export class ServiceManager {
  private readonly active = new Map<string, ActiveService>();
  private readonly logDir: string;
  private readonly inspectPortsImpl: (ports: number[]) => Promise<ServicePortStatus[]>;
  private readonly checkHealthImpl: (url: string) => Promise<boolean>;
  private readonly readLogPreviewImpl?: (projectId: string, serviceId: string) => Promise<string[]>;

  constructor(options: ServiceManagerOptions = {}) {
    this.logDir = options.logDir ?? join(process.cwd(), "work", "service-logs");
    this.inspectPortsImpl = options.inspectPorts ?? inspectPorts;
    this.checkHealthImpl = options.checkHealth ?? checkHealth;
    this.readLogPreviewImpl = options.readLogPreview;
  }

  async snapshot(projectId: string, service: RegisteredService): Promise<ServiceSnapshot> {
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

    return {
      ...service,
      status,
      startedByConsole: isOwnedProcessRunning,
      pid: isOwnedProcessRunning ? active?.child.pid ?? null : occupiedPort?.pid ?? null,
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

  async stop(projectId: string, service: RegisteredService): Promise<ServiceSnapshot> {
    const key = serviceKey(projectId, service.id);
    const active = this.active.get(key);
    if (!active?.child.pid || active.child.exitCode !== null || active.child.killed) {
      throw new Error(`${service.name} was not started by this console.`);
    }

    await terminateProcess(active.child);
    this.active.delete(key);
    return this.snapshot(projectId, service);
  }

  async restart(projectId: string, service: RegisteredService): Promise<ServiceSnapshot> {
    const key = serviceKey(projectId, service.id);
    if (this.active.has(key)) {
      await this.stop(projectId, service);
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

async function terminateProcess(child: ChildProcess): Promise<void> {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
    return;
  }

  child.kill("SIGTERM");
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
