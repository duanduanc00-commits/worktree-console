import { describe, expect, it } from "vitest";

import { groupHealthIssuesByProject, healthIssueLabel, healthIssueTone } from "../src/lib/health-ui";
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
