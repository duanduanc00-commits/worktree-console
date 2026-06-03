import { describe, expect, it } from "vitest";

import { serviceGroupStatusLabel, serviceGroupStatusTone } from "../src/lib/service-groups-ui";

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
});
