import { describe, expect, it } from "vitest";

import {
  serviceKindLabel,
  servicePortLabel,
  servicePrimaryActionLabel,
  serviceShowProcessControls,
  serviceStatusLabel
} from "../src/lib/service-ui";
import type { ServiceSnapshot } from "../src/shared/types";

const baseService: ServiceSnapshot = {
  id: "service-1",
  name: "Service",
  cwd: "E:/repo",
  command: "npm run dev",
  ports: [5273],
  healthUrl: null,
  createdAt: "2026-06-03T00:00:00.000Z",
  updatedAt: "2026-06-03T00:00:00.000Z",
  status: "stopped",
  startedByConsole: false,
  pid: null,
  portsStatus: [{ port: 5273, listening: false, pid: null, processName: null }],
  logPreview: []
};

describe("service-ui", () => {
  it("labels services with no port and no health URL as runnable tasks", () => {
    const task = {
      ...baseService,
      ports: [],
      healthUrl: null,
      portsStatus: []
    };

    expect(serviceKindLabel(task)).toBe("Task");
    expect(serviceStatusLabel(task)).toBe("Ready");
    expect(servicePrimaryActionLabel(task)).toBe("Run");
    expect(serviceShowProcessControls(task)).toBe(false);
    expect(servicePortLabel(task)).toBe("Runs once, no port");
  });

  it("keeps port-backed services as startable long-running services", () => {
    expect(serviceKindLabel(baseService)).toBe("External");
    expect(serviceStatusLabel(baseService)).toBe("Stopped");
    expect(servicePrimaryActionLabel(baseService)).toBe("Start");
    expect(serviceShowProcessControls(baseService)).toBe(true);
    expect(servicePortLabel(baseService)).toBe("Ports 5273");
  });
});
