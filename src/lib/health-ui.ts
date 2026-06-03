import type { HealthIssueKind, HealthIssueSeverity } from "../shared/types";

export function healthIssueTone(severity: HealthIssueSeverity): "neutral" | "clean" | "dirty" | "error" {
  if (severity === "critical") return "error";
  if (severity === "warning") return "dirty";
  return "neutral";
}

export function healthIssueLabel(kind: HealthIssueKind): string {
  const labels: Record<HealthIssueKind, string> = {
    "cleanup-candidate": "Cleanup available",
    "dirty-project": "Project dirty",
    "dirty-worktree": "Worktree dirty",
    "missing-project": "Project missing",
    "occupied-port": "Port occupied",
    "stopped-service": "Service stopped"
  };

  return labels[kind];
}
