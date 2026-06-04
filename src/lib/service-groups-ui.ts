import type { ServiceGroupAction, ServiceGroupStatus } from "../shared/types";

type BadgeTone = "neutral" | "clean" | "dirty" | "error";

export function serviceGroupStatusLabel(status: ServiceGroupStatus): string {
  if (status === "running") return "Running";
  if (status === "partial") return "Partial";
  if (status === "error") return "Error";
  return "Stopped";
}

export function serviceGroupStatusTone(status: ServiceGroupStatus): BadgeTone {
  if (status === "running") return "clean";
  if (status === "partial") return "dirty";
  if (status === "error") return "error";
  return "neutral";
}

export function serviceGroupActionDisabled(
  action: ServiceGroupAction,
  status: ServiceGroupStatus,
  serviceCount: number
): boolean {
  if (serviceCount === 0 || status === "error") return true;
  if (action === "start") return status === "running";
  if (action === "stop") return status === "stopped";
  return status === "stopped";
}

export function serviceGroupActionLabel(action: ServiceGroupAction, busy: boolean): string {
  if (action === "start") return busy ? "Starting..." : "Start Group";
  if (action === "stop") return busy ? "Stopping..." : "Stop Group";
  return busy ? "Restarting..." : "Restart Group";
}
