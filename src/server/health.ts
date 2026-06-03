import type { HealthIssue, HealthIssueKind, HealthIssueSeverity, HealthSummary, ProjectSnapshot } from "../shared/types";

type IssueInput = {
  kind: HealthIssueKind;
  severity: HealthIssueSeverity;
  title: string;
  detail: string;
  project: ProjectSnapshot;
  targetType: HealthIssue["targetType"];
  target: string;
};

const actionLabels: Record<HealthIssueKind, string> = {
  "cleanup-candidate": "Review cleanup",
  "stopped-service": "Open services",
  "dirty-worktree": "Review changes",
  "dirty-project": "Review changes",
  "missing-project": "Inspect",
  "occupied-port": "Inspect"
};

export function buildHealthSummary(projects: ProjectSnapshot[]): HealthSummary {
  const issues: HealthIssue[] = [];

  for (const project of projects) {
    if (project.status === "missing") {
      issues.push(
        issue({
          kind: "missing-project",
          severity: "critical",
          title: `${project.name} is missing`,
          detail: `Project path does not exist: ${project.path}`,
          project,
          targetType: "project",
          target: "project"
        })
      );
    }
  }

  for (const project of projects) {
    for (const service of project.services) {
      if (service.status === "port-occupied") {
        const ports = service.portsStatus
          .filter((port) => port.listening)
          .map((port) => `${port.port}:${port.pid ?? "unknown"}`)
          .join(", ");

        issues.push(
          issue({
            kind: "occupied-port",
            severity: "critical",
            title: `${service.name} ports are occupied`,
            detail: ports ? `Occupied ports: ${ports}` : "One or more configured ports are occupied.",
            project,
            targetType: "service",
            target: service.id
          })
        );
      }
    }
  }

  for (const project of projects) {
    if (project.status === "dirty") {
      const dirtyFiles = project.branch?.dirtyFiles ?? 0;

      issues.push(
        issue({
          kind: "dirty-project",
          severity: "warning",
          title: `${project.name} has uncommitted changes`,
          detail: `${dirtyFiles} dirty file${dirtyFiles === 1 ? "" : "s"} in the project checkout.`,
          project,
          targetType: "project",
          target: "project"
        })
      );
    }
  }

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      if (worktree.clean === false) {
        const dirtyFiles = worktree.dirtyFiles ?? 0;

        issues.push(
          issue({
            kind: "dirty-worktree",
            severity: "warning",
            title: `${worktree.branch ?? worktree.path} has uncommitted changes`,
            detail: `${dirtyFiles} dirty file${dirtyFiles === 1 ? "" : "s"} in the worktree.`,
            project,
            targetType: "worktree",
            target: worktree.path
          })
        );
      }
    }
  }

  for (const project of projects) {
    for (const service of project.services) {
      if (service.status === "stopped") {
        issues.push(
          issue({
            kind: "stopped-service",
            severity: "warning",
            title: `${service.name} is stopped`,
            detail: "The service is not currently running.",
            project,
            targetType: "service",
            target: service.id
          })
        );
      }
    }
  }

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      const matchingBranch = project.branches.find((branch) => branch.name === worktree.branch);

      if (worktree.removal?.canDelete && matchingBranch?.removal.canDelete) {
        issues.push(
          issue({
            kind: "cleanup-candidate",
            severity: "info",
            title: `${worktree.branch ?? worktree.path} can be cleaned up`,
            detail: "The worktree and its branch are both marked safe to delete.",
            project,
            targetType: "worktree",
            target: worktree.path
          })
        );
      }
    }
  }

  return {
    counts: {
      critical: countSeverity(issues, "critical"),
      warning: countSeverity(issues, "warning"),
      info: countSeverity(issues, "info"),
      dirtyProjects: countKind(issues, "dirty-project"),
      dirtyWorktrees: countKind(issues, "dirty-worktree"),
      cleanupCandidates: countKind(issues, "cleanup-candidate"),
      stoppedServices: countKind(issues, "stopped-service"),
      occupiedPorts: countKind(issues, "occupied-port"),
      missingProjects: countKind(issues, "missing-project")
    },
    issues
  };
}

function issue(input: IssueInput): HealthIssue {
  return {
    id: `${input.project.id}:${input.kind}:${input.target}`,
    kind: input.kind,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    projectId: input.project.id,
    projectName: input.project.name,
    projectPath: input.project.path,
    targetType: input.targetType,
    target: input.target,
    actionLabel: actionLabels[input.kind]
  };
}

function countSeverity(issues: HealthIssue[], severity: HealthIssueSeverity): number {
  return issues.filter((issue) => issue.severity === severity).length;
}

function countKind(issues: HealthIssue[], kind: HealthIssueKind): number {
  return issues.filter((issue) => issue.kind === kind).length;
}
