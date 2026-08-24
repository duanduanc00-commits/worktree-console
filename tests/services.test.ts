import { describe, expect, it } from "vitest";

import { ServiceManager } from "../src/server/services";
import type { RegisteredService, ServiceSnapshot } from "../src/shared/types";

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
          cwd: null,
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

  it("matches external worktree services by process working directory", async () => {
    const manager = new ServiceManager({
      inspectPorts: async () => [{ port: 18124, listening: true, pid: 4312, processName: "python.exe" }],
      inspectProcessTree: async () => [
        {
          pid: 4312,
          parentPid: 4000,
          name: "python.exe",
          cwd: "E:/codex/worktrees/9218/voice-assistant",
          executablePath: "D:/ProgramData/anaconda3/envs/voice_assistant/python.exe",
          commandLine: '"python.exe" start_server.py --port 18124'
        }
      ],
      readLogPreview: async () => []
    });
    const worktreeService: RegisteredService = {
      ...service,
      cwd: "E:/codex/worktrees/9218/voice-assistant",
      command: "python start_server.py --port 18124",
      ports: [18124]
    };

    await expect(manager.snapshot("project-1", worktreeService, "E:/voice_assistant/voice-assistant")).resolves.toMatchObject({
      status: "port-occupied",
      startedByConsole: false,
      pid: 4312,
      processCwd: "E:/codex/worktrees/9218/voice-assistant",
      processOwnership: "project",
      processOwnerHint: "Matched service directory in process tree."
    });
  });

  it("matches a registered service launched from a linked worktree", async () => {
    const worktreePath = "C:/Users/dev/.codex/worktrees/feature-preview/demo";
    const manager = new ServiceManager({
      inspectPorts: async () => [{ port: 5274, listening: true, pid: 4312, processName: "node.exe" }],
      inspectProcessTree: async () => [
        {
          pid: 4312,
          parentPid: 4000,
          name: "node.exe",
          cwd: worktreePath,
          executablePath: "E:/Program Files/node.exe",
          commandLine: '"node" node_modules/vite/bin/vite.js'
        }
      ],
      readLogPreview: async () => []
    });

    await expect(manager.snapshot("project-1", service, "E:/demo", [worktreePath])).resolves.toMatchObject({
      status: "port-occupied",
      processCwd: worktreePath,
      processOwnership: "project",
      processOwnerHint: "Matched linked worktree in process tree."
    });
  });

  it("auto-detects unregistered listeners from linked worktrees and groups ports by PID", async () => {
    const worktreePath = "C:/Users/dev/.codex/worktrees/feature-preview/demo";
    const manager = new ServiceManager({
      inspectListeners: async () => [
        { port: 5173, listening: true, pid: 100, processName: null },
        { port: 5174, listening: true, pid: 100, processName: null },
        { port: 3000, listening: true, pid: 200, processName: null },
        { port: 9229, listening: true, pid: 300, processName: null }
      ],
      inspectProcessTree: async (pid) => [
        {
          pid,
          parentPid: 1,
          name: "node.exe",
          cwd: pid === 100 ? `${worktreePath}/apps/web` : pid === 200 ? worktreePath : `${worktreePath}-copy`,
          executablePath: "E:/Program Files/node.exe",
          commandLine: '"node" server.js'
        }
      ]
    });

    await expect(
      manager.discoverWorktreeServices(
        [{ path: worktreePath, branch: "feature/preview" }],
        [serviceSnapshot({ ...service, ports: [3000] })]
      )
    ).resolves.toEqual([
      {
        id: "detected-100",
        worktreePath,
        branch: "feature/preview",
        pid: 100,
        processName: "node.exe",
        processCwd: `${worktreePath}/apps/web`,
        ports: [5173, 5174]
      }
    ]);
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
          cwd: null,
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
          cwd: null,
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

function serviceSnapshot(registeredService: RegisteredService): ServiceSnapshot {
  return {
    ...registeredService,
    status: "running",
    startedByConsole: false,
    pid: 200,
    processCwd: registeredService.cwd,
    processOwnership: "project",
    processOwnerHint: "Matched project path in process tree.",
    portsStatus: registeredService.ports.map((port) => ({
      port,
      listening: true,
      pid: 200,
      processName: "node.exe"
    })),
    logPreview: []
  };
}
