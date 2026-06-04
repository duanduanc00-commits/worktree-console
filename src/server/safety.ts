import type { BranchInfo, RemovalAssessment, WorktreeInfo } from "../shared/types";

const protectedBranchNames = new Set(["main", "master", "develop", "dev", "release"]);

export function assessWorktreeRemoval(worktree: WorktreeInfo, projectPath: string): RemovalAssessment {
  if (worktree.removal?.level === "blocked") {
    return worktree.removal;
  }

  if (samePath(worktree.path, projectPath)) {
    return blocked("Main project", ["This is the registered project directory."]);
  }

  if (!worktree.clean || (worktree.dirtyFiles ?? 0) > 0) {
    return review("Has changes", [`${worktree.dirtyFiles ?? 0} changed files must be reviewed first.`]);
  }

  if (worktree.detached && (worktree.baseRefs ?? []).length === 0) {
    return review("Detached head", ["Detached HEAD is not contained by any reported branch. Confirm the commit is preserved before removing this worktree."]);
  }

  return safe("Safe to remove", ["Worktree is clean and is not the registered project directory."]);
}

export function buildBranchInfo(input: {
  branch: string;
  currentBranch: string | null;
  mergedBranches: string[];
  worktrees: WorktreeInfo[];
}): BranchInfo {
  const current = input.branch === input.currentBranch;
  const protectedBranch = protectedBranchNames.has(input.branch);
  const merged = input.mergedBranches.includes(input.branch);
  const usedByWorktree = input.worktrees.some((worktree) => worktree.branch === input.branch);

  return {
    name: input.branch,
    current,
    protected: protectedBranch,
    merged,
    usedByWorktree,
    removal: assessBranchRemoval({ current, merged, protectedBranch, usedByWorktree })
  };
}

export function assessBranchRemoval(input: {
  current: boolean;
  merged: boolean;
  protectedBranch: boolean;
  usedByWorktree: boolean;
}): RemovalAssessment {
  if (input.current) return blocked("Current branch", ["Cannot delete the currently checked out branch."]);
  if (input.protectedBranch) return blocked("Protected", ["This branch name is protected by the console."]);
  if (input.usedByWorktree) return blocked("In use", ["A worktree is currently using this branch."]);
  if (!input.merged) return review("Unmerged", ["Branch is not merged into the current HEAD."]);
  return safe("Safe to delete", ["Branch is merged and not used by any worktree."]);
}

function safe(label: string, reasons: string[]): RemovalAssessment {
  return { level: "safe", label, reasons, canDelete: true };
}

function review(label: string, reasons: string[]): RemovalAssessment {
  return { level: "review", label, reasons, canDelete: false };
}

function blocked(label: string, reasons: string[]): RemovalAssessment {
  return { level: "blocked", label, reasons, canDelete: false };
}

function samePath(left: string, right: string) {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
