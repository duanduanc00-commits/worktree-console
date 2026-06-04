import { describe, expect, it } from "vitest";

import { healthIssueLabel, healthIssueTone } from "../src/lib/health-ui";

describe("health-ui", () => {
  it("labels severities for compact cards", () => {
    expect(healthIssueTone("critical")).toBe("error");
    expect(healthIssueTone("warning")).toBe("dirty");
    expect(healthIssueTone("info")).toBe("neutral");
    expect(healthIssueLabel("stopped-service")).toBe("Service stopped");
  });
});
