import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  buildRecentCommitArgs,
  buildSyntheticUntrackedDiff,
  handleBufferedDiffError,
  readBoundedRegularFileDiff,
  buildWorktreeDiffArgs,
  limitDiffLines,
  parseBranchTrackingRefs,
  parseBranchStatus,
  parseLastCommitTimestamp,
  parseShortStatusChanges,
  readChangesLatestMtime,
  readLastCommitTimestamp,
  gitStatusTimeoutMs,
  resolveGitExecutionContext,
  resolveGitPath,
  shouldRetryStatusWithoutUntrackedOnTimeout,
  splitGitOperationChanges,
  parseWorktreeList
} from "../src/server/git";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

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

describe("parseBranchTrackingRefs", () => {
  it("parses branch upstream and ahead/behind tracking details", () => {
    const output = [
      "main",
      "",
      "",
      "1700000000",
      "\nfeature/ahead",
      "origin/feature/ahead",
      "[ahead 2]",
      "1700000100",
      "\nfeature/behind",
      "origin/feature/behind",
      "[behind 3]",
      "1700000200",
      "\nfeature/diverged",
      "origin/feature/diverged",
      "[ahead 2, behind 3]",
      "1700000300",
      "\nteam/alice/feature-demo",
      "origin/team/alice/feature-demo",
      "[ahead 1]",
      "1700000400",
      "\nfeature/pipe|name",
      "origin/feature/pipe|name",
      "[behind 1]",
      "1700000500"
    ].join("\0");

    expect(parseBranchTrackingRefs(output)).toEqual([
      { name: "main", upstream: null, upstreamGone: false, ahead: 0, behind: 0, lastCommitAt: 1700000000 },
      { name: "feature/ahead", upstream: "origin/feature/ahead", upstreamGone: false, ahead: 2, behind: 0, lastCommitAt: 1700000100 },
      { name: "feature/behind", upstream: "origin/feature/behind", upstreamGone: false, ahead: 0, behind: 3, lastCommitAt: 1700000200 },
      { name: "feature/diverged", upstream: "origin/feature/diverged", upstreamGone: false, ahead: 2, behind: 3, lastCommitAt: 1700000300 },
      { name: "team/alice/feature-demo", upstream: "origin/team/alice/feature-demo", upstreamGone: false, ahead: 1, behind: 0, lastCommitAt: 1700000400 },
      { name: "feature/pipe|name", upstream: "origin/feature/pipe|name", upstreamGone: false, ahead: 0, behind: 1, lastCommitAt: 1700000500 }
    ]);
  });

  it("preserves gone upstream state instead of treating it as synchronized", () => {
    expect(
      parseBranchTrackingRefs(["feature/gone", "origin/feature/gone", "[gone]", "1700000099"].join("\0"))
    ).toEqual([
      { name: "feature/gone", upstream: "origin/feature/gone", upstreamGone: true, ahead: 0, behind: 0, lastCommitAt: 1700000099 }
    ]);
  });

  it("tolerates unexpected tracking text without throwing", () => {
    expect(
      parseBranchTrackingRefs(["feature/weird", "origin/feature/weird", "[tracking weirdly]", ""].join("\0"))
    ).toEqual([
      { name: "feature/weird", upstream: "origin/feature/weird", upstreamGone: false, ahead: 0, behind: 0, lastCommitAt: null }
    ]);
  });
});

describe("parseLastCommitTimestamp", () => {
  it("parses unix commit timestamps", () => {
    expect(parseLastCommitTimestamp("1700000123\n")).toBe(1700000123);
  });

  it("returns null for missing or invalid timestamps", () => {
    expect(parseLastCommitTimestamp("")).toBeNull();
    expect(parseLastCommitTimestamp("\n")).toBeNull();
    expect(parseLastCommitTimestamp("not-a-number")).toBeNull();
    expect(parseLastCommitTimestamp("0")).toBeNull();
  });
});

describe("readChangesLatestMtime", () => {
  it("returns the newest changed-file mtime in unix seconds", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "worktree-console-mtime-"));
    try {
      await writeFile(join(tempDir, "a.txt"), "a\n");
      const changes = [{ code: "M", path: "a.txt", raw: "M  a.txt" }];

      const latest = await readChangesLatestMtime(tempDir, changes);

      expect(latest).not.toBeNull();
      expect(latest).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to the parent directory for deleted files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "worktree-console-mtime-"));
    try {
      await mkdir(join(tempDir, "sub"));
      const changes = [{ code: "D", path: "sub/gone.txt", raw: " D sub/gone.txt" }];

      const latest = await readChangesLatestMtime(tempDir, changes);

      expect(latest).not.toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("clamps future file mtimes near the current time", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "worktree-console-mtime-"));
    try {
      const filePath = join(tempDir, "future.txt");
      await writeFile(filePath, "future\n");
      const farFuture = new Date("2100-01-01T00:00:00Z");
      await utimes(filePath, farFuture, farFuture);
      const changes = [{ code: "??", path: "future.txt", raw: "?? future.txt" }];

      const latest = await readChangesLatestMtime(tempDir, changes);

      expect(latest).not.toBeNull();
      expect(latest).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns null when no changed path can be inspected", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "worktree-console-mtime-"));
    try {
      const changes = [{ code: "D", path: "missing/gone.txt", raw: " D missing/gone.txt" }];

      expect(await readChangesLatestMtime(tempDir, [])).toBeNull();
      expect(await readChangesLatestMtime(tempDir, changes)).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("readLastCommitTimestamp", () => {
  it("returns null outside a Git repository", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "worktree-console-commit-time-"));
    try {
      expect(await readLastCommitTimestamp(tempDir)).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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

describe("resolveGitExecutionContext", () => {
  it("normalizes slash direction for Git paths", () => {
    expect(resolveGitPath("nested\\repo", "C:/base").replace(/\\/g, "/")).toContain("C:/base/nested/repo");
  });

  it("uses GIT_DIR and GIT_WORK_TREE for file-based worktree gitdirs", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "worktree-console-gitdir-"));
    try {
      const worktreePath = join(tempDir, "feature");
      await writeFile(join(tempDir, "placeholder"), "");
      await mkdir(worktreePath, { recursive: true });
      await writeFile(join(worktreePath, ".git"), "gitdir: ../repo.git/worktrees/feature\n");

      const context = await resolveGitExecutionContext(worktreePath);

      expect(context.cwd).toBe(resolve(worktreePath));
      expect(context.env).toMatchObject({
        GIT_DIR: resolve(worktreePath, "../repo.git/worktrees/feature"),
        GIT_WORK_TREE: resolve(worktreePath)
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Git status timeout settings", () => {
  it("uses a dedicated status timeout when configured", () => {
    const originalStatusTimeout = process.env.WORKTREE_CONSOLE_GIT_STATUS_TIMEOUT_MS;
    const originalGitTimeout = process.env.WORKTREE_CONSOLE_GIT_TIMEOUT_MS;
    process.env.WORKTREE_CONSOLE_GIT_STATUS_TIMEOUT_MS = "3000";
    process.env.WORKTREE_CONSOLE_GIT_TIMEOUT_MS = "15000";

    try {
      expect(gitStatusTimeoutMs()).toBe(3000);
    } finally {
      restoreEnv("WORKTREE_CONSOLE_GIT_STATUS_TIMEOUT_MS", originalStatusTimeout);
      restoreEnv("WORKTREE_CONSOLE_GIT_TIMEOUT_MS", originalGitTimeout);
    }
  });

  it("can disable the slower untracked fallback after status timeout", () => {
    const originalRetry = process.env.WORKTREE_CONSOLE_GIT_STATUS_RETRY_UNTRACKED;
    process.env.WORKTREE_CONSOLE_GIT_STATUS_RETRY_UNTRACKED = "false";

    try {
      expect(shouldRetryStatusWithoutUntrackedOnTimeout()).toBe(false);
    } finally {
      restoreEnv("WORKTREE_CONSOLE_GIT_STATUS_RETRY_UNTRACKED", originalRetry);
    }
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

  it("parses nul-delimited status paths without quoted pseudo-paths", () => {
    const output = " M src/café.txt\0?? docs/说明.md\0";

    expect(parseShortStatusChanges(output)).toEqual([
      { code: "M", path: "src/café.txt", raw: " M src/café.txt" },
      { code: "??", path: "docs/说明.md", raw: "?? docs/说明.md" }
    ]);
  });
});

describe("splitGitOperationChanges", () => {
  it("splits staged and unstaged changes from porcelain status", () => {
    const changes = [
      { code: "M", path: "src/staged.ts", raw: "M  src/staged.ts" },
      { code: "M", path: "src/unstaged.ts", raw: " M src/unstaged.ts" },
      { code: "M", path: "src/both.ts", raw: "MM src/both.ts" },
      { code: "??", path: "src/new.ts", raw: "?? src/new.ts" }
    ];

    expect(splitGitOperationChanges(changes)).toEqual({
      staged: [
        { code: "M", path: "src/staged.ts", raw: "M  src/staged.ts" },
        { code: "M", path: "src/both.ts", raw: "MM src/both.ts" }
      ],
      unstaged: [
        { code: "M", path: "src/unstaged.ts", raw: " M src/unstaged.ts" },
        { code: "M", path: "src/both.ts", raw: "MM src/both.ts" },
        { code: "??", path: "src/new.ts", raw: "?? src/new.ts" }
      ]
    });
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

  it("truncates long single-line regular file diffs by size", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "worktree-console-diff-"));
    try {
      const filePath = join(tempDir, "single-line.txt");
      await writeFile(filePath, `${"a".repeat(32)}SECRET_AFTER_CAP`);

      const result = await readBoundedRegularFileDiff("single-line.txt", filePath, 20, 16);

      expect(result.truncated).toBe(true);
      expect(result.lineCount).toBe(5);
      expect(result.diff).toContain(`+${"a".repeat(16)}`);
      expect(result.diff).not.toContain("SECRET_AFTER_CAP");
      expect(result.diff.length).toBeLessThan(200);
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
