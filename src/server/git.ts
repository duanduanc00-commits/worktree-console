import { access, lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import type { BranchStatus, RecentCommit, WorktreeChange, WorktreeInfo } from "../shared/types";

const execFileAsync = promisify(execFile);
const prettyCommitFormat = "--pretty=format:%h%x1f%s%x1f%an%x1f%cr";
const safeDiffArgs = ["--no-ext-diff", "--no-textconv"];

export type RecentCommitRange = "24h" | "7d" | "30d" | "all";

export type RecentCommitOptions = {
  limit?: number;
  range?: RecentCommitRange;
};

export type SyntheticUntrackedDiffInput =
  | { kind: "file"; content: string }
  | { kind: "symlink"; linkTarget: string }
  | { kind: "unsupported"; description: string };

export function parseBranchStatus(output: string): BranchStatus {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const header = lines[0] ?? "## unknown";
  const body = header.replace(/^##\s*/, "");
  const statusMatch = body.match(/\[(?<status>[^\]]+)\]/);
  const branchSpec = body.replace(/\s*\[[^\]]+\]\s*$/, "");
  const [branch, upstream = null] = branchSpec.split("...");
  const status = statusMatch?.groups?.status ?? "";

  return {
    branch: branch || "unknown",
    upstream,
    ahead: numberFromStatus(status, /ahead\s+(\d+)/),
    behind: numberFromStatus(status, /behind\s+(\d+)/),
    dirtyFiles: Math.max(0, lines.length - 1),
    clean: lines.length <= 1
  };
}

export function parseWorktreeList(output: string): WorktreeInfo[] {
  return output
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const entry: WorktreeInfo = {
        path: "",
        head: null,
        branch: null,
        detached: true
      };

      for (const line of block.split(/\r?\n/)) {
        const [key, ...parts] = line.split(" ");
        const value = parts.join(" ");

        if (key === "worktree") entry.path = value;
        if (key === "HEAD") entry.head = value;
        if (key === "branch") {
          entry.branch = value.replace(/^refs\/heads\//, "");
          entry.detached = false;
        }
        if (key === "locked") {
          entry.removal = {
            level: "blocked",
            label: "Locked",
            reasons: [value ? `Locked: ${value}` : "Worktree is locked."],
            canDelete: false
          };
        }
      }

      return entry;
    });
}

export function parseShortStatusChanges(output: string): WorktreeChange[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((raw) => {
      const code = raw.slice(0, 2).trim() || raw.slice(0, 2);
      const path = raw.slice(3).trim();
      return {
        code,
        path,
        raw
      };
    });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isGitRepository(path: string): Promise<boolean> {
  try {
    const { stdout } = await git(path, ["rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function readBranchStatus(path: string): Promise<BranchStatus> {
  const { stdout } = await git(path, ["status", "--short", "--branch"]);
  return parseBranchStatus(stdout);
}

export async function readWorktreeChanges(path: string): Promise<WorktreeChange[]> {
  const { stdout } = await git(path, ["status", "--short", "--untracked-files=all"]);
  return parseShortStatusChanges(stdout);
}

export function buildWorktreeDiffArgs(filePath: string): string[] {
  return ["diff", ...safeDiffArgs, "--", filePath];
}

export function limitDiffLines(
  output: string,
  maxLines: number
): { diff: string; truncated: boolean; lineCount: number } {
  const lines = output.replace(/\r\n/g, "\n").split("\n");
  if (output.endsWith("\n")) {
    lines.pop();
  }
  const lineCount = output ? lines.length : 0;
  const truncated = lineCount > maxLines;

  return {
    diff: truncated ? lines.slice(0, maxLines).join("\n") : output,
    truncated,
    lineCount
  };
}

export async function readWorktreeFileDiff(
  worktreePath: string,
  filePath: string,
  change?: WorktreeChange,
  maxLines = 200
): Promise<{ diff: string; truncated: boolean; lineCount: number }> {
  if (isUntrackedChange(change)) {
    return limitDiffLines(await buildSyntheticUntrackedDiffFromPath(worktreePath, filePath), maxLines);
  }

  const args = isStagedChange(change) ? buildCachedWorktreeDiffArgs(filePath) : buildWorktreeDiffArgs(filePath);
  const { stdout } = await git(worktreePath, args);
  return limitDiffLines(stdout, maxLines);
}

export async function readShortHead(path: string): Promise<string | null> {
  try {
    const { stdout } = await git(path, ["rev-parse", "--short", "HEAD"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function readContainingBranches(path: string): Promise<string[]> {
  try {
    const { stdout } = await git(path, ["branch", "--contains", "HEAD", "--format=%(refname:short)"]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((branch) => branch !== "(no branch)")
      .filter((branch) => !branch.startsWith("("));
  } catch {
    return [];
  }
}

export async function readWorktrees(path: string): Promise<WorktreeInfo[]> {
  const { stdout } = await git(path, ["worktree", "list", "--porcelain"]);
  return parseWorktreeList(stdout);
}

export async function readBranches(path: string): Promise<string[]> {
  const { stdout } = await git(path, ["branch", "--format=%(refname:short)"]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function readMergedBranches(path: string): Promise<string[]> {
  const { stdout } = await git(path, ["branch", "--merged", "HEAD", "--format=%(refname:short)"]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function removeWorktree(repositoryPath: string, worktreePath: string): Promise<void> {
  await git(repositoryPath, ["worktree", "remove", worktreePath]);
}

export async function deleteBranch(repositoryPath: string, branch: string): Promise<void> {
  await git(repositoryPath, ["branch", "-d", branch]);
}

export function buildRecentCommitArgs(options: RecentCommitOptions = {}): string[] {
  const limit = clampCommitLimit(options.limit ?? 5);
  const args = ["log", `-${limit}`];
  const since = sinceForRange(options.range ?? "all");
  if (since) {
    args.push(`--since=${since}`);
  }
  args.push(prettyCommitFormat);
  return args;
}

export async function readRecentCommits(path: string, options: RecentCommitOptions = {}): Promise<RecentCommit[]> {
  const { stdout } = await git(path, buildRecentCommitArgs(options));

  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, relativeTime] = line.split("\u001f");
      return { hash, subject, author, relativeTime };
    });
}

function clampCommitLimit(limit: number): number {
  if (limit <= 5) return 5;
  if (limit <= 20) return 20;
  return 50;
}

function sinceForRange(range: RecentCommitRange): string | null {
  if (range === "24h") return "24 hours ago";
  if (range === "7d") return "7 days ago";
  if (range === "30d") return "30 days ago";
  return null;
}

function buildCachedWorktreeDiffArgs(filePath: string): string[] {
  return ["diff", "--cached", ...safeDiffArgs, "--", filePath];
}

export function buildSyntheticUntrackedDiff(filePath: string, input: SyntheticUntrackedDiffInput): string {
  if (input.kind === "symlink") {
    return buildOneLineAddedDiff(filePath, "120000", input.linkTarget);
  }

  if (input.kind === "unsupported") {
    return buildOneLineAddedDiff(
      filePath,
      "000000",
      `Unsupported untracked ${input.description}; contents were not read.`
    );
  }

  const lines = input.content.replace(/\r\n/g, "\n").split("\n");
  if (input.content.endsWith("\n")) {
    lines.pop();
  }

  return buildAddedDiffHeader(filePath, "100644").concat(lines.map((line) => `+${line}`)).join("\n");
}

async function buildSyntheticUntrackedDiffFromPath(worktreePath: string, filePath: string): Promise<string> {
  const path = join(worktreePath, filePath);
  const stats = await lstat(path);

  if (stats.isSymbolicLink()) {
    return buildSyntheticUntrackedDiff(filePath, {
      kind: "symlink",
      linkTarget: await readlink(path)
    });
  }

  if (stats.isFile()) {
    return buildSyntheticUntrackedDiff(filePath, {
      kind: "file",
      content: await readFile(path, "utf8")
    });
  }

  return buildSyntheticUntrackedDiff(filePath, {
    kind: "unsupported",
    description: stats.isDirectory() ? "directory" : "file type"
  });
}

function buildOneLineAddedDiff(filePath: string, mode: string, line: string): string {
  return [...buildAddedDiffHeader(filePath, mode), "@@ -0,0 +1 @@", `+${line}`].join("\n");
}

function buildAddedDiffHeader(filePath: string, mode: string): string[] {
  return [`diff --git a/${filePath} b/${filePath}`, `new file mode ${mode}`, "--- /dev/null", `+++ b/${filePath}`];
}

function isStagedChange(change?: WorktreeChange): boolean {
  return Boolean(change && change.raw.slice(0, 1) !== " " && !isUntrackedChange(change));
}

function isUntrackedChange(change?: WorktreeChange): boolean {
  return change?.raw.slice(0, 2) === "??" || change?.code === "??";
}

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    timeout: 12000,
    maxBuffer: 1024 * 1024
  });
}

function numberFromStatus(status: string, pattern: RegExp): number {
  const match = status.match(pattern);
  return match ? Number(match[1]) : 0;
}
