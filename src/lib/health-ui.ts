import type { HealthIssue, HealthIssueKind, HealthIssueSeverity } from "../shared/types";

export type HealthIssueProjectGroup = {
  projectId: string;
  projectName: string;
  projectPath: string;
  issues: HealthIssue[];
};

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

export function groupHealthIssuesByProject(issues: HealthIssue[]): HealthIssueProjectGroup[] {
  const groups = new Map<string, HealthIssueProjectGroup>();

  for (const issue of issues) {
    const group = groups.get(issue.projectId);
    if (group) {
      group.issues.push(issue);
      continue;
    }

    groups.set(issue.projectId, {
      projectId: issue.projectId,
      projectName: issue.projectName,
      projectPath: issue.projectPath,
      issues: [issue]
    });
  }

  return Array.from(groups.values());
}
