export const AUTO_REFRESH_INTERVAL_MS = 30_000;

export type RefreshTrigger = "initial" | "manual" | "operation" | "auto";

export type RefreshRequestTracker = {
  currentRequestId: number;
  inFlight: boolean;
};

export function shouldAutoRefresh(visibilityState: string) {
  return visibilityState === "visible";
}

export function shouldShowRefreshLoading(trigger: RefreshTrigger) {
  return trigger !== "auto";
}

export function startRefreshRequest(tracker: RefreshRequestTracker) {
  tracker.currentRequestId += 1;
  tracker.inFlight = true;
  return tracker.currentRequestId;
}

export function isCurrentRefreshRequest(tracker: RefreshRequestTracker, requestId: number) {
  return tracker.currentRequestId === requestId;
}

export function finishRefreshRequest(tracker: RefreshRequestTracker, requestId: number) {
  if (isCurrentRefreshRequest(tracker, requestId)) {
    tracker.inFlight = false;
    return true;
  }
  return false;
}

export function canStartAutoRefresh({
  autoCycleInFlight,
  refreshInFlight,
  visibilityState
}: {
  autoCycleInFlight: boolean;
  refreshInFlight: boolean;
  visibilityState: string;
}) {
  return shouldAutoRefresh(visibilityState) && !refreshInFlight && !autoCycleInFlight;
}
