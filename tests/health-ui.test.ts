import { describe, expect, it } from "vitest";

import {
  groupHealthIssuesByProject,
  healthIssueLabel,
  healthIssueTone,
  healthMetricMatchesIssue,
  healthMetricTooltip
} from "../src/lib/health-ui";
import type { HealthIssue } from "../src/shared/types";

describe("health-ui", () => {
  it("labels severities for compact cards", () => {
    expect(healthIssueTone("critical")).toBe("error");
    expect(healthIssueTone("warning")).toBe("dirty");
    expect(healthIssueTone("info")).toBe("neutral");
    expect(healthIssueLabel("stopped-service")).toBe("Service stopped");
  });

  it("groups health issues by project while keeping issue order", () => {
    const issues: HealthIssue[] = [
      issue({ id: "a:dirty", projectId: "a", projectName: "Alpha", projectPath: "E:/alpha", title: "Alpha dirty" }),
      issue({ id: "b:dirty", projectId: "b", projectName: "Beta", projectPath: "E:/beta", title: "Beta dirty" }),
      issue({ id: "a:cleanup", projectId: "a", projectName: "Alpha", projectPath: "E:/alpha", title: "Alpha cleanup" })
    ];

    expect(groupHealthIssuesByProject(issues)).toEqual([
      {
        projectId: "a",
        projectName: "Alpha",
        projectPath: "E:/alpha",
        issues: [issues[0], issues[2]]
      },
      {
        projectId: "b",
        projectName: "Beta",
        projectPath: "E:/beta",
        issues: [issues[1]]
      }
    ]);
  });

  it("matches summary metrics to the issues they filter", () => {
    const critical = issue({ id: "missing", kind: "missing-project", severity: "critical" });
    const warning = issue({ id: "dirty", kind: "dirty-project", severity: "warning" });
    const cleanup = issue({ id: "cleanup", kind: "cleanup-candidate", severity: "info" });
    const stopped = issue({ id: "stopped", kind: "stopped-service", severity: "warning" });

    expect(healthMetricMatchesIssue("critical", critical)).toBe(true);
    expect(healthMetricMatchesIssue("critical", warning)).toBe(false);
    expect(healthMetricMatchesIssue("warning", warning)).toBe(true);
    expect(healthMetricMatchesIssue("warning", stopped)).toBe(true);
    expect(healthMetricMatchesIssue("cleanup", cleanup)).toBe(true);
    expect(healthMetricMatchesIssue("cleanup", warning)).toBe(false);
    expect(healthMetricMatchesIssue("stopped", stopped)).toBe(true);
    expect(healthMetricMatchesIssue("stopped", warning)).toBe(false);
  });

  it("keeps health metric hints short", () => {
    expect(healthMetricTooltip("critical")).toBe("Missing projects or occupied ports.");
    expect(healthMetricTooltip("warning")).toBe("Dirty projects, worktrees, or stopped services.");
    expect(healthMetricTooltip("cleanup")).toBe("Items marked safe to delete.");
    expect(healthMetricTooltip("stopped")).toBe("Long-running services not active.");
  });
});

function issue(overrides: Partial<HealthIssue>): HealthIssue {
  return {
    id: "issue",
    kind: "dirty-project",
    severity: "warning",
    title: "Issue",
    detail: "Detail",
    projectId: "project",
    projectName: "Project",
    projectPath: "E:/project",
    targetType: "project",
    target: "project",
    actionLabel: "Inspect",
    ...overrides
  };
}
