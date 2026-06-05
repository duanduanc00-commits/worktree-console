import { describe, expect, it } from "vitest";

import {
  commitDisabledReason,
  gitPanelLayoutClass,
  gitSyncDisabledReason,
  shortGitActionLabel
} from "../src/lib/git-ui";

describe("git-ui helpers", () => {
  it("uses wide focused layout when the Git tab is active", () => {
    expect(gitPanelLayoutClass()).toBe("section git-panel git-panel-wide");
  });

  it("keeps per-file action labels compact", () => {
    expect(shortGitActionLabel("stage")).toBe("Stage");
    expect(shortGitActionLabel("unstage")).toBe("Undo");
  });

  it("disables commit until staged files and message exist", () => {
    expect(commitDisabledReason({ stagedCount: 0, message: "Ship it" })).toBe("Stage files before committing.");
    expect(commitDisabledReason({ stagedCount: 1, message: "   " })).toBe("Write a commit message.");
    expect(commitDisabledReason({ stagedCount: 1, message: "Ship it" })).toBeNull();
  });

  it("describes pull and push disabled states", () => {
    expect(gitSyncDisabledReason("fetch", { upstream: null, clean: false, ahead: 0, behind: 0 })).toBeNull();
    expect(gitSyncDisabledReason("pull", { upstream: null, clean: true, ahead: 0, behind: 0 })).toBe(
      "No upstream branch."
    );
    expect(gitSyncDisabledReason("pull", { upstream: "origin/main", clean: false, ahead: 0, behind: 1 })).toBe(
      "Commit or stash local changes first."
    );
    expect(gitSyncDisabledReason("pull", { upstream: "origin/main", clean: true, ahead: 1, behind: 1 })).toBe(
      "Diverged branch requires terminal review."
    );
    expect(gitSyncDisabledReason("push", { upstream: "origin/main", clean: true, ahead: 0, behind: 0 })).toBe(
      "No local commits to push."
    );
    expect(gitSyncDisabledReason("push", { upstream: "origin/main", clean: true, ahead: 1, behind: 1 })).toBe(
      "Pull or review upstream changes first."
    );
  });
});
