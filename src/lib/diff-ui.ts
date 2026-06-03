export type DiffLineTone = "added" | "removed" | "hunk" | "header" | "context";

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
