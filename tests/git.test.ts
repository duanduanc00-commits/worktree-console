import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  buildRecentCommitArgs,
  buildSyntheticUntrackedDiff,
  handleBufferedDiffError,
  readBoundedRegularFileDiff,
  buildWorktreeDiffArgs,
  limitDiffLines,
  parseBranchStatus,
  parseShortStatusChanges,
  parseWorktreeList
} from "../src/server/git";

describe("parseBranchStatus", () => {
  it("parses the current branch, upstream, ahead/behind counts, and dirty file count", () => {
    const status = [
      "## feature/console...origin/feature/console [ahead 2, behind 1]",
      " M src/App.tsx",
      "?? tests/git.test.ts"
    ].join("\n");

    expect(parseBranchStatus(status)).toEqual({
      branch: "feature/console",
      upstream: "origin/feature/console",
      ahead: 2,
      behind: 1,
      dirtyFiles: 2,
      clean: false
    });
  });

  it("treats a branch with no changed files as clean", () => {
    expect(parseBranchStatus("## main...origin/main")).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      dirtyFiles: 0,
      clean: true
    });
  });
});

describe("parseWorktreeList", () => {
  it("parses porcelain worktree entries", () => {
    const output = [
      "worktree C:/Dev/app",
      "HEAD 1234567890abcdef",
      "branch refs/heads/main",
      "",
      "worktree C:/Dev/app.worktrees/console",
      "HEAD abcdef1234567890",
      "branch refs/heads/feature/console",
      ""
    ].join("\n");

    expect(parseWorktreeList(output)).toEqual([
      {
        path: "C:/Dev/app",
        head: "1234567890abcdef",
        branch: "main",
        detached: false
      },
      {
        path: "C:/Dev/app.worktrees/console",
        head: "abcdef1234567890",
        branch: "feature/console",
        detached: false
      }
    ]);
  });
});

describe("parseShortStatusChanges", () => {
  it("parses changed and untracked files from git short status", () => {
    const output = [" M src/App.tsx", "M  src/server/git.ts", "?? tests/git.test.ts"].join("\n");

    expect(parseShortStatusChanges(output)).toEqual([
      { code: "M", path: "src/App.tsx", raw: " M src/App.tsx" },
      { code: "M", path: "src/server/git.ts", raw: "M  src/server/git.ts" },
      { code: "??", path: "tests/git.test.ts", raw: "?? tests/git.test.ts" }
    ]);
  });
});

describe("buildRecentCommitArgs", () => {
  it("builds git log args with count and since range", () => {
    expect(buildRecentCommitArgs({ limit: 20, range: "7d" })).toEqual([
      "log",
      "-20",
      "--since=7 days ago",
      "--pretty=format:%h%x1f%s%x1f%an%x1f%cr"
    ]);
  });

  it("omits since for all time and clamps unsupported limits", () => {
    expect(buildRecentCommitArgs({ limit: 999, range: "all" })).toEqual([
      "log",
      "-50",
      "--pretty=format:%h%x1f%s%x1f%an%x1f%cr"
    ]);
  });
});

describe("buildWorktreeDiffArgs", () => {
  it("builds safe file diff args for a worktree-relative path", () => {
    expect(buildWorktreeDiffArgs("src/App.tsx")).toEqual([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--",
      "src/App.tsx"
    ]);
  });
});

describe("limitDiffLines", () => {
  it("returns the full diff when it is within the max line count", () => {
    expect(limitDiffLines("one\ntwo", 3)).toEqual({
      diff: "one\ntwo",
      truncated: false,
      lineCount: 2
    });
  });

  it("returns only the first max lines and reports the original line count when truncated", () => {
    expect(limitDiffLines("one\ntwo\nthree", 2)).toEqual({
      diff: "one\ntwo",
      truncated: true,
      lineCount: 3
    });
  });
});

describe("buildSyntheticUntrackedDiff", () => {
  it("builds a symlink diff using only the link target text", () => {
    expect(
      buildSyntheticUntrackedDiff("src/config-link", {
        kind: "symlink",
        linkTarget: "../../secrets/config.json"
      })
    ).toBe(
      [
        "diff --git a/src/config-link b/src/config-link",
        "new file mode 120000",
        "--- /dev/null",
        "+++ b/src/config-link",
        "@@ -0,0 +1 @@",
        "+../../secrets/config.json"
      ].join("\n")
    );
  });

  it("builds an unsupported-file diff message without file contents", () => {
    expect(
      buildSyntheticUntrackedDiff("src/generated", {
        kind: "unsupported",
        description: "directory"
      })
    ).toBe(
      [
        "diff --git a/src/generated b/src/generated",
        "new file mode 000000",
        "--- /dev/null",
        "+++ b/src/generated",
        "@@ -0,0 +1 @@",
        "+Unsupported untracked directory; contents were not read."
      ].join("\n")
    );
  });
});

describe("readBoundedRegularFileDiff", () => {
  it("reads only enough regular file lines to return a bounded synthetic diff", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "worktree-console-diff-"));
    try {
      const filePath = join(tempDir, "large.txt");
      await writeFile(filePath, ["line 1", "line 2", "line 3", "line 4", "line 5"].join("\n"));

      const result = await readBoundedRegularFileDiff("large.txt", filePath, 7);

      expect(result).toEqual({
        diff: [
          "diff --git a/large.txt b/large.txt",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/large.txt",
          "+line 1",
          "+line 2",
          "+line 3"
        ].join("\n"),
        truncated: true,
        lineCount: 8
      });
      expect(result.diff).not.toContain("line 4");
      expect(result.diff).not.toContain("line 5");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("handleBufferedDiffError", () => {
  it("returns bounded partial stdout when git diff exceeds maxBuffer", () => {
    expect(
      handleBufferedDiffError(
        {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          stdout: "one\ntwo\nthree"
        },
        2
      )
    ).toEqual({
      diff: "one\ntwo",
      truncated: true,
      lineCount: 3
    });
  });

  it("returns a truncated explanatory message when overflow has no stdout", () => {
    expect(
      handleBufferedDiffError(
        {
          message: "stdout maxBuffer length exceeded"
        },
        200
      )
    ).toEqual({
      diff: "Diff output exceeded the server buffer before any partial output was captured.",
      truncated: true,
      lineCount: 1
    });
  });

  it("returns null for ordinary git failures", () => {
    expect(handleBufferedDiffError({ code: 1, stderr: "fatal: bad revision" }, 200)).toBeNull();
  });
});
