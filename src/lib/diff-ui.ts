export type DiffLineTone = "added" | "removed" | "hunk" | "header" | "context";

export function worktreeChangesLayoutClass(changeCount: number): string {
  return changeCount > 0 ? "worktree-detail changes-split" : "worktree-detail";
}

export function worktreePanelLayoutClass(hasFocusedChanges: boolean): string {
  return hasFocusedChanges ? "section worktree-panel changes-focused" : "section worktree-panel";
}

export function focusedChangesInspectorWidth({
  currentWidth,
  viewportWidth
}: {
  currentWidth: number;
  viewportWidth: number;
}): number {
  const desiredWidth = Math.min(960, Math.round(viewportWidth * 0.58));
  const maxReadableWidth = Math.max(340, viewportWidth - 420);
  return Math.max(currentWidth, Math.min(desiredWidth, maxReadableWidth));
}

export function diffLineTone(line: string): DiffLineTone {
  if (line.startsWith("@@")) return "hunk";
  if (isDiffHeader(line)) return "header";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}

function isDiffHeader(line: string) {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  );
}
