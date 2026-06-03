import { describe, expect, it } from "vitest";

import { diffLineTone } from "../src/lib/diff-ui";

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
});
