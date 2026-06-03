import { describe, expect, it } from "vitest";

import { assessBranchRemoval, assessWorktreeRemoval } from "../src/server/safety";

describe("assessWorktreeRemoval", () => {
  it("blocks deleting the registered project directory", () => {
    expect(
      assessWorktreeRemoval(
        { path: "E:/repo/app", head: "abc", branch: "main", detached: false, clean: true, dirtyFiles: 0 },
        "E:\\repo\\app"
      )
    ).toMatchObject({ level: "blocked", canDelete: false });
  });

  it("marks clean non-main worktrees as safe", () => {
    expect(
      assessWorktreeRemoval(
        { path: "E:/repo/app/.worktrees/feature", head: "abc", branch: "feature", detached: false, clean: true, dirtyFiles: 0 },
        "E:/repo/app"
      )
    ).toMatchObject({ level: "safe", canDelete: true });
  });

  it("requires review for dirty worktrees", () => {
    expect(
      assessWorktreeRemoval(
        { path: "E:/repo/app/.worktrees/feature", head: "abc", branch: "feature", detached: false, clean: false, dirtyFiles: 2 },
        "E:/repo/app"
      )
    ).toMatchObject({ level: "review", canDelete: false });
  });
});

describe("assessBranchRemoval", () => {
  it("allows merged branches not used by any worktree", () => {
    expect(
      assessBranchRemoval({ current: false, merged: true, protectedBranch: false, usedByWorktree: false })
    ).toMatchObject({ level: "safe", canDelete: true });
  });

  it("blocks branches used by a worktree", () => {
    expect(
      assessBranchRemoval({ current: false, merged: true, protectedBranch: false, usedByWorktree: true })
    ).toMatchObject({ level: "blocked", canDelete: false });
  });
});
