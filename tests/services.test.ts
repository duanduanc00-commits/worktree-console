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

  it("marks external processes as project owned when their process tree includes the project path", async () => {
    const manager = new ServiceManager({
      inspectPorts: async () => [{ port: 5274, listening: true, pid: 4312, processName: "node.exe" }],
      inspectProcessTree: async () => [
        {
          pid: 4312,
          parentPid: 4000,
          name: "node.exe",
          executablePath: "E:/Program Files/node.exe",
          commandLine: '"node" "E:/demo/apps/admin/node_modules/vite/bin/vite.js"'
        }
      ],
      readLogPreview: async () => []
    });

    await expect(manager.snapshot("project-1", service, "E:/demo")).resolves.toMatchObject({
      status: "port-occupied",
      startedByConsole: false,
      processOwnership: "project",
      processOwnerHint: "Matched project path in process tree."
    });
  });

  it("stops an externally started process only when it is matched to the project path", async () => {
    let listening = true;
    const terminatedPids: number[] = [];
    const manager = new ServiceManager({
      inspectPorts: async () => [
        { port: 5274, listening, pid: listening ? 4312 : null, processName: listening ? "node.exe" : null }
      ],
      inspectProcessTree: async () => [
        {
          pid: 4312,
          parentPid: 4000,
          name: "node.exe",
          executablePath: "E:/Program Files/node.exe",
          commandLine: '"node" "E:/demo/apps/admin/server.js"'
        }
      ],
      terminatePid: async (pid) => {
        terminatedPids.push(pid);
        listening = false;
      },
      readLogPreview: async () => []
    });

    await expect(manager.stop("project-1", service, "E:/demo")).resolves.toMatchObject({
      status: "stopped",
      processOwnership: "none"
    });
    expect(terminatedPids).toEqual([4312]);
  });

  it("refuses to stop an external process when its process tree cannot be matched to the project", async () => {
    const terminatedPids: number[] = [];
    const manager = new ServiceManager({
      inspectPorts: async () => [{ port: 5274, listening: true, pid: 4312, processName: "node.exe" }],
      inspectProcessTree: async () => [
        {
          pid: 4312,
          parentPid: 4000,
          name: "node.exe",
          executablePath: "E:/Program Files/node.exe",
          commandLine: '"node" "E:/other-project/server.js"'
        }
      ],
      terminatePid: async (pid) => {
        terminatedPids.push(pid);
      },
      readLogPreview: async () => []
    });

    await expect(manager.stop("project-1", service, "E:/demo")).rejects.toThrow(
      "External process is not recognized as part of this project."
    );
    expect(terminatedPids).toEqual([]);
  });
});
