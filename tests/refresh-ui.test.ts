import { describe, expect, it } from "vitest";

import { AUTO_REFRESH_INTERVAL_MS, shouldAutoRefresh } from "../src/lib/refresh-ui";

describe("refresh-ui", () => {
  it("refreshes visible dashboards every 30 seconds", () => {
    expect(AUTO_REFRESH_INTERVAL_MS).toBe(30_000);
    expect(shouldAutoRefresh("visible")).toBe(true);
  });

  it("pauses automatic refresh while the browser tab is hidden", () => {
    expect(shouldAutoRefresh("hidden")).toBe(false);
    expect(shouldAutoRefresh("prerender")).toBe(false);
  });
});
