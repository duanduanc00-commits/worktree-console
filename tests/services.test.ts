import { describe, expect, it } from "vitest";

import { ServiceManager } from "../src/server/services";
import type { RegisteredService } from "../src/shared/types";

const service: RegisteredService = {
  id: "svc-1",
  name: "Admin",
  cwd: "E:/demo",
  command: "npm run admin",
  ports: [5274],
  healthUrl: null,
  createdAt: "2026-06-03T00:00:00.000Z",
  updatedAt: "2026-06-03T00:00:00.000Z"
};

describe("ServiceManager", () => {
  it("marks services as stopped when no configured port is listening", async () => {
    const manager = new ServiceManager({
      inspectPorts: async () => [{ port: 5274, listening: false, pid: null, processName: null }],
      readLogPreview: async () => []
    });

    await expect(manager.snapshot("project-1", service)).resolves.toMatchObject({
      status: "stopped",
      startedByConsole: false,
      pid: null,
      portsStatus: [{ port: 5274, listening: false }]
    });
  });

  it("marks externally running services as port occupied", async () => {
    const manager = new ServiceManager({
      inspectPorts: async () => [{ port: 5274, listening: true, pid: 4312, processName: "node.exe" }],
      readLogPreview: async () => []
    });

    await expect(manager.snapshot("project-1", service)).resolves.toMatchObject({
      status: "port-occupied",
      startedByConsole: false,
      pid: 4312,
      portsStatus: [{ port: 5274, listening: true, pid: 4312, processName: "node.exe" }]
    });
  });
});
