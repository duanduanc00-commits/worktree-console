import type { ServiceGroupStatus } from "../shared/types";

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
