import type { ServiceSnapshot } from "../shared/types";

export function isRunnableTask(service: ServiceSnapshot): boolean {
  return service.ports.length === 0 && !service.healthUrl;
}

export function serviceKindLabel(service: ServiceSnapshot): string {
  if (isRunnableTask(service)) return "Task";
  return service.startedByConsole ? "Console" : "External";
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
