import type { BranchInfo, WorktreeInfo } from "../shared/types";

export function sortWorktreesByRecentActivity(worktrees: WorktreeInfo[]): WorktreeInfo[] {
  return [...worktrees].sort(compareByTimestampDescending((worktree) => worktree.lastActivityAt));
}

export function sortBranchesByRecentActivity(branches: BranchInfo[]): BranchInfo[] {
  return [...branches].sort(compareByTimestampDescending((branch) => branch.lastCommitAt));
}

function compareByTimestampDescending<T>(
  readTimestamp: (item: T) => number | null | undefined
): (left: T, right: T) => number {
  return (left, right) => {
    const leftTime = readTimestamp(left);
    const rightTime = readTimestamp(right);
    if (leftTime === rightTime) return 0;
    if (leftTime === null || leftTime === undefined) return 1;
    if (rightTime === null || rightTime === undefined) return -1;
    return rightTime - leftTime;
  };
}
