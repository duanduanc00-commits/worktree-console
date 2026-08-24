import { describe, expect, it } from "vitest";

import { sortBranchesByRecentActivity, sortWorktreesByRecentActivity } from "../src/server/ordering";
import type { BranchInfo, RemovalAssessment, WorktreeInfo } from "../src/shared/types";

const removal: RemovalAssessment = {
  level: "safe",
  label: "Safe",
  reasons: [],
  canDelete: true
};

function worktree(path: string, lastActivityAt: number | null | undefined): WorktreeInfo {
  return { path, head: null, branch: path, detached: false, lastActivityAt };
}

function branch(name: string, lastCommitAt: number | null | undefined): BranchInfo {
  return {
    name,
    current: false,
    protected: false,
    merged: false,
    usedByWorktree: false,
    lastCommitAt,
    removal
  };
}

describe("sortWorktreesByRecentActivity", () => {
  it("orders worktrees by most recent activity first", () => {
    const sorted = sortWorktreesByRecentActivity([
      worktree("old", 100),
      worktree("newest", 300),
      worktree("middle", 200)
    ]);

    expect(sorted.map((item) => item.path)).toEqual(["newest", "middle", "old"]);
  });

  it("keeps worktrees without activity timestamps at the end in input order", () => {
    const sorted = sortWorktreesByRecentActivity([
      worktree("unknown-a", null),
      worktree("fresh", 500),
      worktree("unknown-b", undefined),
      worktree("stale", 10)
    ]);

    expect(sorted.map((item) => item.path)).toEqual(["fresh", "stale", "unknown-a", "unknown-b"]);
  });

  it("preserves input order for equal timestamps", () => {
    const sorted = sortWorktreesByRecentActivity([
      worktree("main-checkout", 100),
      worktree("linked-same-commit", 100)
    ]);

    expect(sorted.map((item) => item.path)).toEqual(["main-checkout", "linked-same-commit"]);
  });

  it("does not mutate the input array", () => {
    const input = [worktree("old", 1), worktree("new", 2)];
    const snapshot = [...input];

    sortWorktreesByRecentActivity(input);

    expect(input.map((item) => item.path)).toEqual(snapshot.map((item) => item.path));
  });
});

describe("sortBranchesByRecentActivity", () => {
  it("orders branches by most recent commit first", () => {
    const sorted = sortBranchesByRecentActivity([
      branch("stale", 100),
      branch("active", 900),
      branch("idle", 400)
    ]);

    expect(sorted.map((item) => item.name)).toEqual(["active", "idle", "stale"]);
  });

  it("keeps branches without commit timestamps at the end in input order", () => {
    const sorted = sortBranchesByRecentActivity([
      branch("unknown", null),
      branch("recent", 700),
      branch("also-unknown", undefined)
    ]);

    expect(sorted.map((item) => item.name)).toEqual(["recent", "unknown", "also-unknown"]);
  });

  it("preserves input order for equal timestamps", () => {
    const sorted = sortBranchesByRecentActivity([
      branch("alpha", 250),
      branch("beta", 250)
    ]);

    expect(sorted.map((item) => item.name)).toEqual(["alpha", "beta"]);
  });
});
