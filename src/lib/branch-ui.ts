import type { BranchInfo, WorktreeInfo } from "../shared/types";

export type BranchWorktreeAssociation = {
  worktree: WorktreeInfo;
  changeLabel: string;
  tooltip: string;
};

export function branchWorktreeAssociation(
  branch: BranchInfo,
  worktrees: WorktreeInfo[]
): BranchWorktreeAssociation | null {
  const worktree = worktrees.find((candidate) => candidate.branch === branch.name) ?? null;
  if (!worktree) return null;

  const dirtyFiles = worktree.dirtyFiles ?? 0;
  const changeLabel = worktree.clean ? "Clean" : `${dirtyFiles} changed`;
  const tooltip = worktree.clean
    ? `This branch is checked out in ${worktree.path}. No local uncommitted changes were reported for this worktree.`
    : `This branch is checked out in ${worktree.path} with ${dirtyFiles} local changed file(s).`;

  return { worktree, changeLabel, tooltip };
}
