import { describe, expect, it } from "vitest";

import { buildHealthSummary } from "../src/server/health";
import type { BranchInfo, ProjectSnapshot, ServiceSnapshot, WorktreeInfo } from "../src/shared/types";

const removal = {
  level: "blocked" as const,
  label: "Blocked",
  reasons: ["In use"],
  canDelete: false
};

function branch(overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: "feature/demo",
    current: false,
    protected: false,
    merged: true,
    usedByWorktree: false,
    removal,
    ...overrides
  };
}

function worktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: "C:/repos/demo/.worktrees/feature-demo",
    head: "abcdef123456",
    shortHead: "abcdef1",
    branch: "feature/demo",
    detached: false,
    baseRefs: ["main"],
    removal,
    clean: true,
    dirtyFiles: 0,
    changes: [],
    ...overrides
  };
}

function service(overrides: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return {
    id: "service-1",
    name: "Web",
    cwd: "C:/repos/demo",
    command: "npm run dev",
    ports: [5173],
    healthUrl: null,
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    status: "running",
    startedByConsole: true,
    pid: 1234,
    processOwnership: "console",
    processOwnerHint: "Started by this console.",
    portsStatus: [{ port: 5173, listening: true, pid: 1234, processName: "node.exe" }],
    logPreview: [],
    ...overrides
  };
}

function project(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    id: "project-1",
    name: "Demo",
    path: "C:/repos/demo",
    tags: [],
    pinned: false,
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    exists: true,
    isGitRepository: true,
    status: "clean",
    branch: {
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      dirtyFiles: 0,
      clean: true
    },
    worktrees: [],
    branches: [],
    recentCommits: [],
    services: [],
    ...overrides
  };
}

describe("buildHealthSummary", () => {
  it("flags dirty worktrees, safe cleanup, and stopped services", () => {
    const summary = buildHealthSummary([
      project({
        worktrees: [
          worktree({ path: "C:/repos/demo/.worktrees/dirty", branch: "feature/dirty", clean: false, dirtyFiles: 3 }),
          worktree({
            path: "C:/repos/demo/.worktrees/done",
            branch: "feature/done",
            removal: { level: "safe", label: "Safe", reasons: ["Merged"], canDelete: true }
          })
        ],
        branches: [
          branch({
            name: "feature/done",
            removal: { level: "safe", label: "Safe", reasons: ["Merged"], canDelete: true }
          })
        ],
        services: [service({ id: "service-stopped", name: "Preview", status: "stopped", pid: null })]
      })
    ]);

    expect(summary.issues.map((issue) => issue.kind)).toEqual([
      "dirty-worktree",
      "stopped-service",
      "cleanup-candidate"
    ]);
    expect(summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "project-1:dirty-worktree:C:/repos/demo/.worktrees/dirty",
          severity: "warning",
          targetType: "worktree",
          target: "C:/repos/demo/.worktrees/dirty",
          actionLabel: "Review changes",
          detail: expect.stringContaining("3")
        }),
        expect.objectContaining({
          id: "project-1:cleanup-candidate:C:/repos/demo/.worktrees/done",
          severity: "info",
          targetType: "worktree",
          target: "C:/repos/demo/.worktrees/done",
          actionLabel: "Review cleanup"
        }),
        expect.objectContaining({
          id: "project-1:stopped-service:service-stopped",
          severity: "warning",
          targetType: "service",
          target: "service-stopped",
          actionLabel: "Open services"
        })
      ])
    );
  });

  it("flags missing projects and occupied ports before lower-priority issues", () => {
    const summary = buildHealthSummary([
      project({
        id: "project-1",
        name: "Missing",
        status: "missing",
        exists: false,
        isGitRepository: false
      }),
      project({
        id: "project-2",
        name: "Busy",
        services: [
          service({
            id: "service-busy",
            name: "API",
            status: "port-occupied",
            startedByConsole: false,
            pid: 4321,
            portsStatus: [
              { port: 3000, listening: true, pid: 4321, processName: "node.exe" },
              { port: 3001, listening: true, pid: 9876, processName: "vite.exe" }
            ]
          })
        ],
        worktrees: [worktree({ path: "C:/repos/demo/.worktrees/dirty", branch: "feature/dirty", clean: false })]
      })
    ]);

    expect(summary.issues.map((issue) => issue.kind)).toEqual([
      "missing-project",
      "occupied-port",
      "dirty-worktree"
    ]);
    expect(summary.issues[0]).toMatchObject({
      id: "project-1:missing-project:project",
      severity: "critical",
      targetType: "project",
      actionLabel: "Inspect"
    });
    expect(summary.issues[1]).toMatchObject({
      id: "project-2:occupied-port:service-busy",
      severity: "critical",
      targetType: "service",
      target: "service-busy",
      actionLabel: "Inspect",
      detail: expect.stringContaining("3000:4321")
    });
    expect(summary.issues[1].detail).toContain("3001:9876");
  });

  it("flags removable worktrees even when the matching branch is blocked", () => {
    const summary = buildHealthSummary([
      project({
        worktrees: [
          worktree({
            path: "C:/repos/demo/.worktrees/done",
            branch: "feature/done",
            removal: { level: "safe", label: "Safe", reasons: ["Merged"], canDelete: true }
          })
        ],
        branches: [
          branch({
            name: "feature/done",
            usedByWorktree: true,
            removal: { level: "blocked", label: "In use", reasons: ["Used by worktree"], canDelete: false }
          })
        ]
      })
    ]);

    expect(summary.issues).toEqual([
      expect.objectContaining({
        kind: "cleanup-candidate",
        targetType: "worktree",
        target: "C:/repos/demo/.worktrees/done"
      })
    ]);
    expect(summary.counts.cleanupCandidates).toBe(1);
  });

  it("flags cleanup only for safe branches not represented by worktrees", () => {
    const summary = buildHealthSummary([
      project({
        worktrees: [
          worktree({
            path: "C:/repos/demo/.worktrees/attached",
            branch: "feature/attached",
            removal: { level: "safe", label: "Safe", reasons: ["Merged"], canDelete: true }
          })
        ],
        branches: [
          branch({
            name: "feature/attached",
            usedByWorktree: true,
            removal: { level: "safe", label: "Safe", reasons: ["Merged"], canDelete: true }
          }),
          branch({
            name: "feature/old",
            removal: { level: "safe", label: "Safe", reasons: ["Merged"], canDelete: true }
          })
        ]
      })
    ]);

    expect(summary.issues).toEqual([
      expect.objectContaining({
        kind: "cleanup-candidate",
        targetType: "worktree",
        target: "C:/repos/demo/.worktrees/attached"
      }),
      expect.objectContaining({
        kind: "cleanup-candidate",
        targetType: "branch",
        target: "feature/old"
      })
    ]);
    expect(summary.counts.cleanupCandidates).toBe(2);
  });

  it("does not warn for stopped one-shot task services", () => {
    const summary = buildHealthSummary([
      project({
        services: [
          service({ id: "task-null-health", status: "stopped", pid: null, ports: [], portsStatus: [], healthUrl: null }),
          service({ id: "task-empty-health", status: "stopped", pid: null, ports: [], portsStatus: [], healthUrl: "" })
        ]
      })
    ]);

    expect(summary.issues).toEqual([]);
    expect(summary.counts.stoppedServices).toBe(0);
  });

  it("counts critical, warning, and info issues correctly", () => {
    const summary = buildHealthSummary([
      project({ status: "missing", exists: false, isGitRepository: false }),
      project({
        id: "project-2",
        name: "Dirty",
        status: "dirty",
        branch: {
          branch: "main",
          upstream: "origin/main",
          ahead: 0,
          behind: 0,
          dirtyFiles: 4,
          clean: false
        },
        worktrees: [
          worktree({ path: "C:/repos/dirty/.worktrees/feature", clean: false, dirtyFiles: 2 }),
          worktree({
            path: "C:/repos/dirty/.worktrees/old",
            branch: "feature/old",
            removal: { level: "safe", label: "Safe", reasons: ["Merged"], canDelete: true }
          })
        ],
        branches: [
          branch({
            name: "feature/old",
            removal: { level: "safe", label: "Safe", reasons: ["Merged"], canDelete: true }
          })
        ],
        services: [
          service({ id: "service-stopped", status: "stopped", pid: null }),
          service({
            id: "service-busy",
            status: "port-occupied",
            startedByConsole: false,
            pid: 4321,
            portsStatus: [{ port: 3000, listening: true, pid: 4321, processName: "node.exe" }]
          })
        ]
      })
    ]);

    expect(summary.counts).toEqual({
      critical: 2,
      warning: 3,
      info: 1,
      dirtyProjects: 1,
      dirtyWorktrees: 1,
      cleanupCandidates: 1,
      stoppedServices: 1,
      occupiedPorts: 1,
      missingProjects: 1
    });
  });
});
