export const AUTO_REFRESH_INTERVAL_MS = 30_000;

export function shouldAutoRefresh(visibilityState: string) {
  return visibilityState === "visible";
}
