// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";

import {
  commitDisabledReason,
  gitPanelLayoutClass,
  gitSyncDisabledReason,
  shortGitActionLabel
} from "../src/lib/git-ui";
import type { DashboardResponse, GitOperationStatus, ProjectSnapshot, WorktreeDiffResponse } from "../src/shared/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("git-ui helpers", () => {
  it("uses wide focused layout when the Git tab is active", () => {
    expect(gitPanelLayoutClass()).toBe("section git-panel git-panel-wide");
  });

  it("keeps per-file action labels compact", () => {
    expect(shortGitActionLabel("stage")).toBe("Stage");
    expect(shortGitActionLabel("unstage")).toBe("Undo");
  });

  it("disables commit until staged files and message exist", () => {
    expect(commitDisabledReason({ stagedCount: 0, message: "Ship it" })).toBe("Stage files before committing.");
    expect(commitDisabledReason({ stagedCount: 1, message: "   " })).toBe("Write a commit message.");
    expect(commitDisabledReason({ stagedCount: 1, message: "Ship it" })).toBeNull();
  });

  it("describes pull and push disabled states", () => {
    expect(gitSyncDisabledReason("fetch", { upstream: null, clean: false, ahead: 0, behind: 0 })).toBeNull();
    expect(gitSyncDisabledReason("pull", { upstream: null, clean: true, ahead: 0, behind: 0 })).toBe(
      "No upstream branch."
    );
    expect(gitSyncDisabledReason("pull", { upstream: "origin/main", clean: false, ahead: 0, behind: 1 })).toBe(
      "Commit or stash local changes first."
    );
    expect(gitSyncDisabledReason("pull", { upstream: "origin/main", clean: true, ahead: 1, behind: 1 })).toBe(
      "Diverged branch requires terminal review."
    );
    expect(gitSyncDisabledReason("push", { upstream: "origin/main", clean: true, ahead: 0, behind: 0 })).toBe(
      "No local commits to push."
    );
    expect(gitSyncDisabledReason("push", { upstream: "origin/main", clean: true, ahead: 1, behind: 1 })).toBe(
      "Pull or review upstream changes first."
    );
  });

  it("renders the Git tab as a focused wide inspector view", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/projects") {
          return new Response(JSON.stringify(dashboardFixture()), {
            headers: { "Content-Type": "application/json" },
            status: 200
          });
        }

        return new Response(JSON.stringify({ error: `Unexpected request: ${String(input)}` }), {
          headers: { "Content-Type": "application/json" },
          status: 500
        });
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));

    await waitFor(() => {
      expect((container.querySelector(".app-body") as HTMLElement).style.getPropertyValue("--inspector-width")).toBe(
        "928px"
      );
    });
  });

  it("ignores stale git operation results after switching projects", async () => {
    const alpha = projectFixture({
      id: "alpha",
      name: "Alpha",
      path: "E:/repo/alpha",
      branch: {
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        dirtyFiles: 1,
        clean: false
      }
    });
    const beta = projectFixture({
      id: "beta",
      name: "Beta",
      path: "E:/repo/beta",
      branch: {
        branch: "feature/beta",
        upstream: "origin/feature/beta",
        ahead: 0,
        behind: 0,
        dirtyFiles: 1,
        clean: false
      }
    });
    const alphaStatus = gitStatusFixture({
      projectId: alpha.id,
      worktreePath: alpha.path,
      branch: "main",
      changes: {
        unstaged: [],
        staged: [{ code: "M", path: "src/alpha.ts", raw: "M  src/alpha.ts" }]
      }
    });
    const betaStatus = gitStatusFixture({
      projectId: beta.id,
      worktreePath: beta.path,
      branch: "feature/beta",
      upstream: "origin/feature/beta",
      changes: {
        unstaged: [],
        staged: [{ code: "M", path: "src/beta.ts", raw: "M  src/beta.ts" }]
      }
    });
    const staleAlphaCommit = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture([alpha, beta]));
        }
        if (url.startsWith("/api/projects/alpha/git/status")) {
          return jsonResponse(alphaStatus);
        }
        if (url.startsWith("/api/projects/beta/git/status")) {
          return jsonResponse(betaStatus);
        }
        if (url === "/api/projects/alpha/git/commit") {
          return staleAlphaCommit.promise;
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    await waitFor(() => expect(gitPanelText(container)).toContain("main"));

    fireEvent.change(screen.getByPlaceholderText("Describe the staged change"), {
      target: { value: "Alpha commit" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    fireEvent.click(await screen.findByText("Beta"));

    await waitFor(() => expect(gitPanelText(container)).toContain("feature/beta"));
    fireEvent.change(screen.getByPlaceholderText("Describe the staged change"), {
      target: { value: "Beta draft" }
    });

    await act(async () => {
      staleAlphaCommit.resolve(jsonResponse({ ok: true, status: gitStatusFixture({ ...alphaStatus, clean: true }) }));
      await staleAlphaCommit.promise;
    });

    await waitFor(() => {
      expect(gitPanelText(container)).toContain("feature/beta");
      expect(gitPanelText(container)).not.toContain("E:/repo/alpha");
      expect((screen.getByPlaceholderText("Describe the staged change") as HTMLTextAreaElement).value).toBe(
        "Beta draft"
      );
    });
  });

  it("clears a selected diff after staging that file", async () => {
    const status = gitStatusFixture({
      changes: {
        unstaged: [{ code: "M", path: "src/App.tsx", raw: " M src/App.tsx" }],
        staged: []
      }
    });
    const stagedStatus = gitStatusFixture({
      changes: {
        unstaged: [],
        staged: [{ code: "M", path: "src/App.tsx", raw: "M  src/App.tsx" }]
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture());
        }
        if (url.startsWith("/api/projects/project-1/git/status")) {
          return jsonResponse(status);
        }
        if (url.startsWith("/api/projects/project-1/worktrees/diff")) {
          return jsonResponse(
            diffFixture({
              filePath: "src/App.tsx",
              diff: "diff --git a/src/App.tsx b/src/App.tsx\n@@ -1 +1 @@\n-old stale diff marker\n+new stale diff marker"
            })
          );
        }
        if (url === "/api/projects/project-1/git/stage") {
          return jsonResponse({ ok: true, status: stagedStatus });
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByText("src/App.tsx"));
    await screen.findByLabelText("Diff preview for src/App.tsx");

    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    await waitFor(() => {
      expect(gitPanelText(container)).toContain("Select a file to preview its diff.");
      expect(gitPanelText(container)).not.toContain("old stale diff marker");
      expect(screen.queryByLabelText("Diff preview for src/App.tsx")).toBeNull();
    });
  });
});

function projectFixture(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    id: "project-1",
    name: "Console",
    path: "E:/repo/console",
    tags: [],
    pinned: false,
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    exists: true,
    isGitRepository: true,
    status: "dirty",
    branch: {
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      dirtyFiles: 1,
      clean: false
    },
    branches: [],
    recentCommits: [],
    services: [],
    serviceGroups: [],
    worktrees: [],
    ...overrides
  };
}

function dashboardFixture(projects: ProjectSnapshot[] = [projectFixture()]): DashboardResponse {
  return {
    projects,
    summary: {
      projects: projects.length,
      worktrees: 0,
      services: 0,
      runningServices: 0,
      dirty: projects.filter((project) => project.status === "dirty").length,
      missing: 0,
      clean: projects.filter((project) => project.status === "clean").length
    },
    health: {
      counts: {
        critical: 0,
        warning: 0,
        info: 0,
        dirtyProjects: 1,
        dirtyWorktrees: 0,
        cleanupCandidates: 0,
        stoppedServices: 0,
        occupiedPorts: 0,
        missingProjects: 0
      },
      issues: []
    }
  };
}

function gitStatusFixture(overrides: Partial<GitOperationStatus> = {}): GitOperationStatus {
  return {
    projectId: "project-1",
    worktreePath: "E:/repo/console",
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    clean: false,
    changes: {
      unstaged: [],
      staged: [{ code: "M", path: "src/App.tsx", raw: "M  src/App.tsx" }]
    },
    stashes: [],
    ...overrides
  };
}

function diffFixture(overrides: Partial<WorktreeDiffResponse> = {}): WorktreeDiffResponse {
  return {
    worktreePath: "E:/repo/console",
    filePath: "src/App.tsx",
    diff: "diff --git a/src/App.tsx b/src/App.tsx\n@@ -1 +1 @@\n-old\n+new",
    truncated: false,
    lineCount: 4,
    ...overrides
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function gitPanelText(container: HTMLElement) {
  return container.querySelector(".git-panel")?.textContent ?? "";
}
