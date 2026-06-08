import { describe, expect, it } from "vitest";

import {
  AUTO_REFRESH_INTERVAL_MS,
  canStartAutoRefresh,
  finishRefreshRequest,
  isCurrentRefreshRequest,
  shouldBackOffAutoRefresh,
  startRefreshRequest,
  shouldAutoRefresh,
  shouldShowRefreshLoading
} from "../src/lib/refresh-ui";

describe("refresh-ui", () => {
  it("refreshes visible dashboards every 30 seconds", () => {
    expect(AUTO_REFRESH_INTERVAL_MS).toBe(30_000);
    expect(shouldAutoRefresh("visible")).toBe(true);
  });

  it("pauses automatic refresh while the browser tab is hidden", () => {
    expect(shouldAutoRefresh("hidden")).toBe(false);
    expect(shouldAutoRefresh("prerender")).toBe(false);
  });

  it("keeps automatic refresh from showing the global loading state", () => {
    expect(shouldShowRefreshLoading("initial")).toBe(true);
    expect(shouldShowRefreshLoading("manual")).toBe(true);
    expect(shouldShowRefreshLoading("operation")).toBe(true);
    expect(shouldShowRefreshLoading("auto")).toBe(false);
  });

  it("prevents stale refresh requests from applying after a newer request starts", () => {
    const tracker = { currentRequestId: 0, inFlight: false };

    const olderRequest = startRefreshRequest(tracker);
    const newerRequest = startRefreshRequest(tracker);

    expect(isCurrentRefreshRequest(tracker, olderRequest)).toBe(false);
    expect(isCurrentRefreshRequest(tracker, newerRequest)).toBe(true);

    expect(finishRefreshRequest(tracker, olderRequest)).toBe(false);
    expect(tracker.inFlight).toBe(true);

    expect(finishRefreshRequest(tracker, newerRequest)).toBe(true);
    expect(tracker.inFlight).toBe(false);
  });

  it("starts automatic refresh only when visible and no refresh is already running", () => {
    expect(canStartAutoRefresh({ visibilityState: "visible", refreshInFlight: false, autoCycleInFlight: false })).toBe(true);
    expect(canStartAutoRefresh({ visibilityState: "hidden", refreshInFlight: false, autoCycleInFlight: false })).toBe(false);
    expect(canStartAutoRefresh({ visibilityState: "visible", refreshInFlight: true, autoCycleInFlight: false })).toBe(false);
    expect(canStartAutoRefresh({ visibilityState: "visible", refreshInFlight: false, autoCycleInFlight: true })).toBe(false);
  });

  it("skips one automatic refresh cycle after a slow refresh", () => {
    expect(shouldBackOffAutoRefresh(AUTO_REFRESH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldBackOffAutoRefresh(AUTO_REFRESH_INTERVAL_MS)).toBe(true);
    expect(
      canStartAutoRefresh({
        visibilityState: "visible",
        refreshInFlight: false,
        autoCycleInFlight: false,
        backoffPending: true
      })
    ).toBe(false);
  });
});
