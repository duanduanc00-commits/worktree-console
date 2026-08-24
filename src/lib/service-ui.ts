import type { ServiceSnapshot } from "../shared/types";

export type ServiceExternalStopConfirmation = {
  title: string;
  description: string;
  details: Array<{ label: string; value: string }>;
  footer: string;
};

export function isRunnableTask(service: ServiceSnapshot): boolean {
  return service.ports.length === 0 && !service.healthUrl;
}

export function serviceKindLabel(service: ServiceSnapshot): string {
  if (isRunnableTask(service)) return "Task";
  if (service.processOwnership === "console" || service.startedByConsole) return "Console";
  if (service.processOwnership === "project") return "Project external";
  return "External";
}

export function serviceStatusLabel(service: ServiceSnapshot): string {
  if (isRunnableTask(service) && service.status === "stopped") return "Ready";
  if (service.status === "running") return "Running";
  if (service.status === "starting") return "Starting";
  if (service.status === "port-occupied") return "Port Occupied";
  if (service.status === "error") return "Error";
  return "Stopped";
}

export function serviceStatusTone(service: ServiceSnapshot): "neutral" | "clean" | "dirty" | "error" {
  if (service.status === "running") return "clean";
  if (service.status === "starting") return "dirty";
  if (service.status === "error" || service.status === "port-occupied") return "error";
  return "neutral";
}

export function servicePrimaryActionLabel(service: ServiceSnapshot): string {
  return isRunnableTask(service) ? "Run" : "Start";
}

export function serviceShowProcessControls(service: ServiceSnapshot): boolean {
  return !isRunnableTask(service);
}

export function serviceCanStop(service: ServiceSnapshot): boolean {
  if (isRunnableTask(service)) return false;
  if (!isActiveService(service)) return false;
  if (service.processOwnership === "console" || service.startedByConsole) return true;
  return service.processOwnership === "project" && Boolean(service.pid);
}

export function serviceCanRestart(service: ServiceSnapshot): boolean {
  if (isRunnableTask(service)) return false;
  if (!isActiveService(service)) return false;
  return service.processOwnership === "console" || service.startedByConsole;
}

export function serviceExternalStopConfirmation(service: ServiceSnapshot): ServiceExternalStopConfirmation | null {
  if (service.startedByConsole || service.processOwnership !== "project") {
    return null;
  }

  return {
    title: `Stop external service "${service.name}"?`,
    description:
      "This process was not started from Worktree Console, but its process tree matches this project.",
    details: [
      { label: "Ports", value: listeningPortLabel(service) },
      { label: "PID(s)", value: listeningPidLabel(service) },
      { label: "Match", value: service.processOwnerHint ?? "Matched to this project." }
    ],
    footer: "The backend will re-check the port and project match before terminating it."
  };
}

export function serviceUrl(service: ServiceSnapshot): string | null {
  if (service.healthUrl) return service.healthUrl;
  const port = service.ports[0];
  return port ? `http://127.0.0.1:${port}` : null;
}

export function servicePortLabel(service: ServiceSnapshot): string {
  if (isRunnableTask(service)) return "Runs once, no port";
  if (service.ports.length === 0) return "No ports";
  return `Ports ${service.ports.join(", ")}`;
}

export function serviceLaunchPath(service: ServiceSnapshot): string {
  return service.processCwd ?? service.cwd;
}

export function serviceConfiguredPath(service: ServiceSnapshot): string | null {
  const launchPath = normalizePathForDisplay(serviceLaunchPath(service));
  const configuredPath = normalizePathForDisplay(service.cwd);
  return launchPath === configuredPath ? null : service.cwd;
}

function isActiveService(service: ServiceSnapshot): boolean {
  return service.status === "running" || service.status === "starting" || service.status === "port-occupied";
}

function listeningPortLabel(service: ServiceSnapshot): string {
  const ports = service.portsStatus.filter((port) => port.listening).map((port) => String(port.port));
  return ports.length > 0 ? ports.join(", ") : service.ports.join(", ");
}

function listeningPidLabel(service: ServiceSnapshot): string {
  const pids = Array.from(
    new Set(
      service.portsStatus
        .filter((port) => port.listening && port.pid)
        .map((port) => String(port.pid))
    )
  );
  return pids.length > 0 ? pids.join(", ") : "Unknown";
}

function normalizePathForDisplay(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
