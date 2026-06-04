import { describe, expect, it } from "vitest";

import { branchWorktreeAssociation } from "../src/lib/branch-ui";
import type { BranchInfo, WorktreeInfo } from "../src/shared/types";

const removal = {
  level: "blocked" as const,
  label: "Blocked",
  reasons: [],
  canDelete: false
};

function branch(overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: "feature/chat",
    current: false,
    protected: false,
    merged: false,
    usedByWorktree: true,
    removal,
    ...overrides
  };
}

function worktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: "E:/repo/.worktrees/feature-chat",
    head: "abcdef",
    shortHead: "abcdef1",
    branch: "feature/chat",
    detached: false,
    clean: false,
    dirtyFiles: 3,
    changes: [
      { code: "M", path: "src/app.ts", raw: " M src/app.ts" },
      { code: "??", path: "notes.md", raw: "?? notes.md" }
    ],
    removal,
    ...overrides
  };
}

describe("branchWorktreeAssociation", () => {
  it("links a branch to its worktree changes", () => {
    const association = branchWorktreeAssociation(branch(), [worktree()]);

    expect(association).toEqual({
      worktree: expect.objectContaining({ path: "E:/repo/.worktrees/feature-chat" }),
      changeLabel: "3 changed",
      tooltip: "This branch is checked out in E:/repo/.worktrees/feature-chat with 3 local changed file(s)."
    });
  });

  it("shows clean linked worktrees without claiming branch-local changes", () => {
    const association = branchWorktreeAssociation(branch(), [worktree({ clean: true, dirtyFiles: 0, changes: [] })]);

    expect(association?.changeLabel).toBe("Clean");
    expect(association?.tooltip).toContain("No local uncommitted changes");
  });

  it("does not associate detached or unrelated worktrees", () => {
    const association = branchWorktreeAssociation(branch({ name: "feature/missing" }), [
      worktree({ branch: "feature/chat" }),
      worktree({ branch: null, detached: true })
    ]);

    expect(association).toBeNull();
  });
});
