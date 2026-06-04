import { describe, expect, it } from "vitest";

import {
  diffLineTone,
  focusedChangesInspectorWidth,
  worktreeChangesLayoutClass,
  worktreePanelLayoutClass
} from "../src/lib/diff-ui";

describe("diffLineTone", () => {
  it("classifies changed, hunk, header, and context lines", () => {
    expect(diffLineTone("+added")).toBe("added");
    expect(diffLineTone("-removed")).toBe("removed");
    expect(diffLineTone("@@ -1,2 +1,3 @@")).toBe("hunk");
    expect(diffLineTone("diff --git a/src/App.tsx b/src/App.tsx")).toBe("header");
    expect(diffLineTone(" unchanged")).toBe("context");
  });

  it("keeps file headers separate from added and removed source lines", () => {
    expect(diffLineTone("+++ b/src/App.tsx")).toBe("header");
    expect(diffLineTone("--- a/src/App.tsx")).toBe("header");
  });

  it("uses a split changes layout only when there are changed files", () => {
    expect(worktreeChangesLayoutClass(0)).toBe("worktree-detail");
    expect(worktreeChangesLayoutClass(1)).toBe("worktree-detail changes-split");
    expect(worktreeChangesLayoutClass(24)).toBe("worktree-detail changes-split");
  });

  it("focuses the changes view instead of stacking it beside the worktree list", () => {
    expect(worktreePanelLayoutClass(false)).toBe("section worktree-panel");
    expect(worktreePanelLayoutClass(true)).toBe("section worktree-panel changes-focused");
  });

  it("expands the inspector to a readable changes width without shrinking it", () => {
    expect(focusedChangesInspectorWidth({ currentWidth: 640, viewportWidth: 1600 })).toBe(928);
    expect(focusedChangesInspectorWidth({ currentWidth: 980, viewportWidth: 1600 })).toBe(980);
    expect(focusedChangesInspectorWidth({ currentWidth: 640, viewportWidth: 1000 })).toBe(640);
  });
});
