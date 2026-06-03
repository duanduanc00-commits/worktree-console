import { describe, expect, it } from "vitest";

import {
  serviceGroupActionDisabled,
  serviceGroupStatusLabel,
  serviceGroupStatusTone
} from "../src/lib/service-groups-ui";

describe("service-groups-ui", () => {
  it("labels service group statuses", () => {
    expect(serviceGroupStatusLabel("running")).toBe("Running");
    expect(serviceGroupStatusLabel("partial")).toBe("Partial");
    expect(serviceGroupStatusLabel("stopped")).toBe("Stopped");
    expect(serviceGroupStatusLabel("error")).toBe("Error");
  });

  it("maps service group statuses to badge tones", () => {
    expect(serviceGroupStatusTone("running")).toBe("clean");
    expect(serviceGroupStatusTone("partial")).toBe("dirty");
    expect(serviceGroupStatusTone("stopped")).toBe("neutral");
    expect(serviceGroupStatusTone("error")).toBe("error");
  });

  it("disables duplicate or unavailable group actions from status", () => {
    expect(serviceGroupActionDisabled("start", "running", 2)).toBe(true);
    expect(serviceGroupActionDisabled("start", "partial", 2)).toBe(false);
    expect(serviceGroupActionDisabled("stop", "stopped", 2)).toBe(true);
    expect(serviceGroupActionDisabled("stop", "running", 2)).toBe(false);
    expect(serviceGroupActionDisabled("restart", "stopped", 2)).toBe(true);
    expect(serviceGroupActionDisabled("restart", "error", 2)).toBe(true);
    expect(serviceGroupActionDisabled("restart", "partial", 2)).toBe(false);
  });

  it("disables all group actions when the group has no services", () => {
    expect(serviceGroupActionDisabled("start", "stopped", 0)).toBe(true);
    expect(serviceGroupActionDisabled("stop", "running", 0)).toBe(true);
    expect(serviceGroupActionDisabled("restart", "running", 0)).toBe(true);
  });
});
