export type GitSyncAction = "fetch" | "pull" | "push";

export function gitPanelLayoutClass(): string {
  return "section git-panel git-panel-wide";
}

export function shortGitActionLabel(action: "stage" | "unstage"): string {
  return action === "stage" ? "Stage" : "Undo";
}

export function commitDisabledReason({ stagedCount, message }: { stagedCount: number; message: string }): string | null {
  if (stagedCount <= 0) return "Stage files before committing.";
  if (message.trim().length === 0) return "Write a commit message.";
  return null;
}

export function gitSyncDisabledReason(
  action: GitSyncAction,
  status: { upstream: string | null; clean: boolean; ahead: number; behind: number }
): string | null {
  if (action === "fetch") return null;
  if (!status.upstream) return "No upstream branch.";
  if (action === "pull") {
    if (!status.clean) return "Commit or stash local changes first.";
    if (status.ahead > 0 && status.behind > 0) return "Diverged branch requires terminal review.";
    return null;
  }
  if (status.ahead <= 0) return "No local commits to push.";
  if (status.behind > 0) return "Pull or review upstream changes first.";
  return null;
}
