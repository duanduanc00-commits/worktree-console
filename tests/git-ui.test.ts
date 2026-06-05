// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App";

import {
  commitDisabledReason,
  gitPanelLayoutClass,
  gitSyncDisabledReason,
  shortGitActionLabel
} from "../src/lib/git-ui";
import type { DashboardResponse, ProjectSnapshot } from "../src/shared/types";

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
});

function dashboardFixture(): DashboardResponse {
  const project: ProjectSnapshot = {
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
    worktrees: []
  };

  return {
    projects: [project],
    summary: {
      projects: 1,
      worktrees: 0,
      services: 0,
      runningServices: 0,
      dirty: 1,
      missing: 0,
      clean: 0
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
