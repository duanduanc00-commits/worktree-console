import { realpathSync } from "node:fs";

import { readBranchStatus, readStashes, readWorktreeChanges, splitGitOperationChanges } from "./git";
import type { GitOperationStatus, ProjectSnapshot, RegisteredProject, WorktreeChange } from "../shared/types";

export class GitOperationError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function buildGitOperationStatus(
  project: RegisteredProject,
  snapshot: ProjectSnapshot,
  requestedPath?: string
): Promise<GitOperationStatus> {
  const targetPath = resolveGitTargetPath(project, snapshot, requestedPath);
  const [branch, changes, stashes] = await Promise.all([
    readBranchStatus(targetPath),
    readWorktreeChanges(targetPath),
    readStashes(targetPath)
  ]);

  return {
    projectId: project.id,
    worktreePath: targetPath,
    branch: branch.branch,
    upstream: branch.upstream,
    ahead: branch.ahead,
    behind: branch.behind,
    clean: branch.clean,
    changes: splitGitOperationChanges(changes),
    stashes
  };
}

export function resolveGitTargetPath(
  project: RegisteredProject,
  snapshot: ProjectSnapshot,
  requestedPath?: string
): string {
  const targetPath = requestedPath?.trim() || project.path;
  if (samePath(project.path, targetPath)) {
    if (!snapshot.exists || !snapshot.isGitRepository) {
      throw new GitOperationError(404, "Git target worktree was not found in this registered project.");
    }
    return project.path;
  }

  const worktree = snapshot.worktrees.find((candidate) => samePath(candidate.path, targetPath));
  if (!worktree) {
    throw new GitOperationError(404, "Git target worktree was not found in this registered project.");
  }

  return worktree.path;
}

export function assertFilesReported(files: string[], changes: WorktreeChange[], label: string): void {
  const reported = new Set(changes.map((change) => change.path));
  const missing = files.filter((file) => !reported.has(file));
  if (missing.length > 0) {
    throw new GitOperationError(409, `${label} file is not in the current Git status: ${missing.join(", ")}.`);
  }
}

export function parseGitFilesPayload(body: unknown, changes: WorktreeChange[], label: string): string[] {
  const payload = body as { all?: unknown; files?: unknown };
  if (payload?.all === true) {
    if (changes.length === 0) {
      throw new GitOperationError(409, `No ${label.toLowerCase()} files are currently reported.`);
    }
    return unique(changes.map((change) => change.path));
  }

  if (!Array.isArray(payload?.files)) {
    throw new GitOperationError(400, `${label} requires files or all.`);
  }

  const files = payload.files;
  if (files.length === 0 || files.some((file) => typeof file !== "string" || file.length === 0)) {
    throw new GitOperationError(400, `${label} files must be a non-empty string array.`);
  }

  const uniqueFiles = unique(files as string[]);
  assertFilesReported(uniqueFiles, changes, label);
  return uniqueFiles;
}

export function assertCanPull(status: GitOperationStatus): void {
  if (!status.upstream) {
    throw new GitOperationError(409, "Cannot pull because this branch has no upstream.");
  }
  if (!status.clean) {
    throw new GitOperationError(409, "Cannot pull while local changes are present.");
  }
  if (status.ahead > 0 && status.behind > 0) {
    throw new GitOperationError(409, "Cannot pull a diverged branch from the console.");
  }
}

export function assertCanPush(status: GitOperationStatus): void {
  if (!status.upstream) {
    throw new GitOperationError(409, "Cannot push because this branch has no upstream.");
  }
  if (status.ahead <= 0) {
    throw new GitOperationError(409, "There are no local commits to push.");
  }
  if (status.behind > 0) {
    throw new GitOperationError(409, "Cannot push while the branch is behind upstream.");
  }
}

export function assertCanCommit(status: GitOperationStatus, message: string): string {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new GitOperationError(400, "Commit message is required.");
  }
  if (status.changes.staged.length === 0) {
    throw new GitOperationError(409, "Cannot commit because no files are staged.");
  }
  return trimmedMessage;
}

export function assertCanStash(status: GitOperationStatus): void {
  if (status.changes.staged.length === 0 && status.changes.unstaged.length === 0) {
    throw new GitOperationError(409, "Cannot stash because there are no local changes.");
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function samePath(left: string, right: string) {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string) {
  try {
    return realpathSync.native(path).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  } catch {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }
}
