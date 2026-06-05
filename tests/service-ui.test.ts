import { describe, expect, it } from "vitest";

import {
  serviceExternalStopConfirmation,
  serviceCanRestart,
  serviceCanStop,
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
  processOwnership: "none",
  processOwnerHint: null,
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
    expect(serviceCanStop(task)).toBe(false);
  });

  it("keeps port-backed services as startable long-running services", () => {
    expect(serviceKindLabel(baseService)).toBe("External");
    expect(serviceStatusLabel(baseService)).toBe("Stopped");
    expect(servicePrimaryActionLabel(baseService)).toBe("Start");
    expect(serviceShowProcessControls(baseService)).toBe(true);
    expect(servicePortLabel(baseService)).toBe("Ports 5273");
    expect(serviceCanStop(baseService)).toBe(false);
  });

  it("allows stopping project-owned external services but keeps restart console-only", () => {
    const projectExternal: ServiceSnapshot = {
      ...baseService,
      status: "port-occupied",
      pid: 4312,
      processOwnership: "project",
      processOwnerHint: "Matched project path in process tree.",
      portsStatus: [{ port: 5273, listening: true, pid: 4312, processName: "node.exe" }]
    };

    expect(serviceKindLabel(projectExternal)).toBe("Project external");
    expect(serviceCanStop(projectExternal)).toBe(true);
    expect(serviceCanRestart(projectExternal)).toBe(false);
  });

  it("does not allow stopping unknown external services", () => {
    const unknownExternal: ServiceSnapshot = {
      ...baseService,
      status: "port-occupied",
      pid: 4312,
      processOwnership: "unknown",
      processOwnerHint: null,
      portsStatus: [{ port: 5273, listening: true, pid: 4312, processName: "node.exe" }]
    };

    expect(serviceKindLabel(unknownExternal)).toBe("External");
    expect(serviceCanStop(unknownExternal)).toBe(false);
    expect(serviceCanRestart(unknownExternal)).toBe(false);
  });

  it("builds confirmation details for project-owned external stops", () => {
    const projectExternal: ServiceSnapshot = {
      ...baseService,
      name: "Web",
      status: "running",
      pid: 4312,
      processOwnership: "project",
      processOwnerHint: "Matched project path in process tree.",
      portsStatus: [{ port: 5273, listening: true, pid: 4312, processName: "node.exe" }]
    };

    expect(serviceExternalStopConfirmation(projectExternal)).toEqual({
      title: 'Stop external service "Web"?',
      description:
        "This process was not started from Worktree Console, but its process tree matches this project.",
      details: [
        { label: "Ports", value: "5273" },
        { label: "PID(s)", value: "4312" },
        { label: "Match", value: "Matched project path in process tree." }
      ],
      footer: "The backend will re-check the port and project match before terminating it."
    });
  });

  it("does not build external stop confirmation for console or unknown services", () => {
    expect(
      serviceExternalStopConfirmation({
        ...baseService,
        status: "running",
        startedByConsole: true,
        processOwnership: "console",
        pid: 1234
      })
    ).toBeNull();
    expect(
      serviceExternalStopConfirmation({
        ...baseService,
        status: "port-occupied",
        processOwnership: "unknown",
        pid: 4312
      })
    ).toBeNull();
  });
});
