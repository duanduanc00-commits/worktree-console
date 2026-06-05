import { createReadStream } from "node:fs";
import { access, lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import type {
  BranchStatus,
  GitOperationChangeGroups,
  GitStashEntry,
  RecentCommit,
  WorktreeChange,
  WorktreeInfo
} from "../shared/types";

const execFileAsync = promisify(execFile);
const prettyCommitFormat = "--pretty=format:%h%x1f%s%x1f%an%x1f%cr";
const safeDiffArgs = ["--no-ext-diff", "--no-textconv"];
const untrackedDiffPreviewChars = 64 * 1024;

export type RecentCommitRange = "24h" | "7d" | "30d" | "all";

export type RecentCommitOptions = {
  limit?: number;
  range?: RecentCommitRange;
};

export type BranchTrackingInfo = {
  name: string;
  upstream: string | null;
  upstreamGone: boolean;
  ahead: number;
  behind: number;
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

export function parseBranchTrackingRefs(output: string): BranchTrackingInfo[] {
  const entries: BranchTrackingInfo[] = [];
  const fields = output.split("\0").map(stripRecordSeparator);

  for (let index = 0; index + 2 < fields.length; index += 3) {
    const branchName = fields[index];
    if (!branchName) continue;

    const upstream = fields[index + 1] || null;
    const track = fields[index + 2];
    const upstreamGone = track === "[gone]";
    entries.push({
      name: branchName,
      upstream,
      upstreamGone,
      ahead: upstream && !upstreamGone ? numberFromStatus(track, /ahead\s+(\d+)/) : 0,
      behind: upstream && !upstreamGone ? numberFromStatus(track, /behind\s+(\d+)/) : 0
    });
  }

  return entries;
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
  if (output.includes("\0")) {
    return parseNulShortStatusChanges(output);
  }

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

function parseNulShortStatusChanges(output: string): WorktreeChange[] {
  const records = output.split("\0").filter(Boolean);
  const changes: WorktreeChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const raw = records[index];
    if (raw.length < 4) continue;

    const status = raw.slice(0, 2);
    const code = status.trim() || status;
    changes.push({
      code,
      path: raw.slice(3),
      raw
    });

    if (status.includes("R") || status.includes("C")) {
      index += 1;
    }
  }

  return changes;
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
  const { stdout } = await git(path, ["status", "--short", "--untracked-files=all", "-z"]);
  return parseShortStatusChanges(stdout);
}

export function splitGitOperationChanges(changes: WorktreeChange[]): GitOperationChangeGroups {
  return {
    staged: changes.filter(hasStagedChange),
    unstaged: changes.filter((change) => hasUnstagedChange(change) || isUntrackedChange(change))
  };
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
    return buildSyntheticUntrackedDiffFromPath(worktreePath, filePath, maxLines);
  }

  try {
    const diffOutputs = await Promise.all(
      buildTrackedWorktreeDiffArgs(filePath, change).map(async (args) => {
        const { stdout } = await git(worktreePath, args);
        return stdout;
      })
    );
    return limitDiffLines(diffOutputs.filter(Boolean).join("\n"), maxLines);
  } catch (error) {
    const overflow = handleBufferedDiffError(error, maxLines);
    if (overflow) return overflow;
    throw error;
  }
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

export async function readBranchTracking(path: string): Promise<BranchTrackingInfo[]> {
  const { stdout } = await git(path, [
    "for-each-ref",
    "--format=%(refname:short)%00%(upstream:short)%00%(upstream:track)%00",
    "refs/heads"
  ]);
  return parseBranchTrackingRefs(stdout);
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

export async function fetchRepository(path: string): Promise<void> {
  await git(path, ["fetch", "--prune"]);
}

export async function pullRepository(path: string): Promise<void> {
  await git(path, ["pull", "--ff-only"]);
}

export async function pushRepository(path: string): Promise<void> {
  await git(path, ["push"]);
}

export async function stageFiles(path: string, filePaths: string[]): Promise<void> {
  await git(path, ["add", "--", ...filePaths]);
}

export async function unstageFiles(path: string, filePaths: string[]): Promise<void> {
  await git(path, ["restore", "--staged", "--", ...filePaths]);
}

export async function commitStagedFiles(path: string, message: string): Promise<void> {
  await git(path, ["commit", "-m", message]);
}

export async function createStash(path: string, message?: string): Promise<void> {
  const args = ["stash", "push"];
  const trimmedMessage = message?.trim();
  if (trimmedMessage) {
    args.push("-m", trimmedMessage);
  }
  await git(path, args);
}

export function parseStashList(output: string): GitStashEntry[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = "", subject = ""] = line.split("\u001f");
      const index = Number(name.match(/stash@\{(\d+)\}/)?.[1] ?? 0);
      const subjectMatch = subject.match(/^On (?<branch>[^:]+):\s*(?<message>.*)$/);
      return {
        index,
        name,
        branch: subjectMatch?.groups?.branch ?? null,
        message: subjectMatch?.groups?.message ?? subject
      };
    });
}

export async function readStashes(path: string): Promise<GitStashEntry[]> {
  const { stdout } = await git(path, ["stash", "list", "--format=%gd%x1f%gs"]);
  return parseStashList(stdout);
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

function buildTrackedWorktreeDiffArgs(filePath: string, change?: WorktreeChange): string[][] {
  if (hasStagedChange(change) && hasUnstagedChange(change)) {
    return [buildCachedWorktreeDiffArgs(filePath), buildWorktreeDiffArgs(filePath)];
  }
  if (hasStagedChange(change)) {
    return [buildCachedWorktreeDiffArgs(filePath)];
  }
  return [buildWorktreeDiffArgs(filePath)];
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

export async function readBoundedRegularFileDiff(
  filePath: string,
  absolutePath: string,
  maxLines: number,
  maxChars = untrackedDiffPreviewChars
): Promise<{ diff: string; truncated: boolean; lineCount: number }> {
  const header = buildAddedDiffHeader(filePath, "100644");
  const contentLineLimit = Math.max(0, maxLines - header.length);
  const contentCharLimit = Math.max(0, maxChars);
  if (contentLineLimit === 0) {
    return {
      diff: header.slice(0, maxLines).join("\n"),
      truncated: true,
      lineCount: header.length + 1
    };
  }

  if (contentCharLimit === 0) {
    return {
      diff: header.join("\n"),
      truncated: true,
      lineCount: header.length + 1
    };
  }

  const content = await readBoundedTextLines(absolutePath, contentLineLimit, contentCharLimit);
  const lines = header.concat(content.lines.map((line) => `+${line}`));

  return {
    diff: lines.slice(0, maxLines).join("\n"),
    truncated: content.truncated,
    lineCount: content.truncatedBy === "line" ? maxLines + 1 : lines.length
  };
}

export function handleBufferedDiffError(
  error: unknown,
  maxLines: number
): { diff: string; truncated: boolean; lineCount: number } | null {
  if (!isMaxBufferError(error)) {
    return null;
  }

  const stdout = typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : "";
  if (stdout) {
    return {
      ...limitDiffLines(stdout, maxLines),
      truncated: true
    };
  }

  return {
    diff: "Diff output exceeded the server buffer before any partial output was captured.",
    truncated: true,
    lineCount: 1
  };
}

async function buildSyntheticUntrackedDiffFromPath(
  worktreePath: string,
  filePath: string,
  maxLines: number
): Promise<{ diff: string; truncated: boolean; lineCount: number }> {
  const path = join(worktreePath, filePath);
  const stats = await lstat(path);

  if (stats.isSymbolicLink()) {
    return limitDiffLines(
      buildSyntheticUntrackedDiff(filePath, {
        kind: "symlink",
        linkTarget: await readlink(path)
      }),
      maxLines
    );
  }

  if (stats.isFile()) {
    return readBoundedRegularFileDiff(filePath, path, maxLines);
  }

  return limitDiffLines(
    buildSyntheticUntrackedDiff(filePath, {
      kind: "unsupported",
      description: stats.isDirectory() ? "directory" : "file type"
    }),
    maxLines
  );
}

function buildOneLineAddedDiff(filePath: string, mode: string, line: string): string {
  return [...buildAddedDiffHeader(filePath, mode), "@@ -0,0 +1 @@", `+${line}`].join("\n");
}

function buildAddedDiffHeader(filePath: string, mode: string): string[] {
  return [`diff --git a/${filePath} b/${filePath}`, `new file mode ${mode}`, "--- /dev/null", `+++ b/${filePath}`];
}

function hasStagedChange(change?: WorktreeChange): boolean {
  return Boolean(change && change.raw.slice(0, 1) !== " " && !isUntrackedChange(change));
}

function hasUnstagedChange(change?: WorktreeChange): boolean {
  return Boolean(change && change.raw.slice(1, 2) !== " " && !isUntrackedChange(change));
}

function isUntrackedChange(change?: WorktreeChange): boolean {
  return change?.raw.slice(0, 2) === "??" || change?.code === "??";
}

async function readBoundedTextLines(
  path: string,
  maxLines: number,
  maxChars: number
): Promise<{ lines: string[]; truncated: boolean; truncatedBy?: "line" | "size" }> {
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 64 * 1024 });
  let text = "";

  for await (const chunk of stream) {
    text += chunk;
    if (text.length > maxChars) {
      stream.destroy();
      return {
        lines: splitTextLines(text.slice(0, maxChars)),
        truncated: true,
        truncatedBy: "size"
      };
    }

    const lines = splitTextLines(text);
    if (lines.length > maxLines) {
      stream.destroy();
      return {
        lines: lines.slice(0, maxLines),
        truncated: true,
        truncatedBy: "line"
      };
    }
  }

  return {
    lines: splitTextLines(text),
    truncated: false
  };
}

function splitTextLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (text.endsWith("\n")) {
    lines.pop();
  }
  return text ? lines : [];
}

function stripRecordSeparator(value: string): string {
  return value.replace(/^[\r\n]+|[\r\n]+$/g, "");
}

function isMaxBufferError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
    (typeof candidate.message === "string" && candidate.message.includes("maxBuffer"));
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
