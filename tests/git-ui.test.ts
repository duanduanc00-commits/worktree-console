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
import type {
  DashboardResponse,
  GitOperationStatus,
  ProjectSnapshot,
  RecentCommit,
  WorktreeDiffResponse
} from "../src/shared/types";

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

  it("does not open worktree changes when the user is selecting worktree text", async () => {
    const worktreePath = "E:/repo/console/.worktrees/feature-a";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/projects") {
          return jsonResponse(
            dashboardFixture([
              projectFixture({
                worktrees: [
                  {
                    path: worktreePath,
                    head: "abc1234",
                    branch: "feature/a",
                    detached: false,
                    clean: false,
                    dirtyFiles: 1,
                    changes: [{ code: "M", path: "src/App.tsx", raw: " M src/App.tsx" }],
                    removal: { level: "blocked", label: "Has changes", reasons: ["Dirty worktree"], canDelete: false },
                    baseRefs: ["main"]
                  }
                ]
              })
            ])
          );
        }

        return jsonResponse({ error: `Unexpected request: ${String(input)}` }, 500);
      })
    );
    render(createElement(App));

    const pathText = await screen.findByText(worktreePath);
    const getSelection = vi.spyOn(window, "getSelection").mockReturnValue({
      anchorNode: pathText.firstChild,
      focusNode: pathText.firstChild,
      isCollapsed: false,
      toString: () => worktreePath
    } as Selection);

    fireEvent.click(pathText);

    expect(screen.queryByText("Changes")).toBeNull();
    expect(screen.getByText(worktreePath)).toBeTruthy();

    getSelection.mockReturnValue({
      isCollapsed: true,
      toString: () => ""
    } as Selection);
    fireEvent.click(pathText);

    expect(await screen.findByText("Changes")).toBeTruthy();
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

  it("switches the commits tab between the main checkout and worktrees", async () => {
    const project = projectFixture({
      recentCommits: [commitFixture({ hash: "main1", subject: "Main commit" })],
      worktrees: [
        {
          path: "E:/repo/console/.worktrees/feature-a",
          head: "abc123",
          shortHead: "abc123",
          branch: "feature/a",
          detached: false,
          clean: true,
          dirtyFiles: 0,
          changes: []
        }
      ]
    });
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture([project]));
        }
        if (url.includes("path=E%3A%2Frepo%2Fconsole%2F.worktrees%2Ffeature-a")) {
          return jsonResponse([commitFixture({ hash: "feat1", subject: "Feature commit" })]);
        }
        if (url.startsWith("/api/projects/project-1/commits")) {
          return jsonResponse([commitFixture({ hash: "main2", subject: "Main refreshed commit" })]);
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Commits" }));
    await screen.findByText("Main refreshed commit");

    fireEvent.change(screen.getByLabelText("Commit target"), {
      target: { value: "E:/repo/console/.worktrees/feature-a" }
    });

    await screen.findByText("Feature commit");
    expect(requestedUrls.some((url) => url.includes("path=E%3A%2Frepo%2Fconsole%2F.worktrees%2Ffeature-a"))).toBe(
      true
    );
  });

  it("does not list the main checkout twice in git target selectors", async () => {
    const project = projectFixture({
      worktrees: [
        {
          path: "E:/repo/console",
          head: "abc123",
          shortHead: "abc123",
          branch: "main",
          detached: false,
          clean: true,
          dirtyFiles: 0,
          changes: []
        },
        {
          path: "E:/repo/console/.worktrees/feature-a",
          head: "def456",
          shortHead: "def456",
          branch: "feature/a",
          detached: false,
          clean: true,
          dirtyFiles: 0,
          changes: []
        }
      ]
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture([project]));
        }
        if (url.startsWith("/api/projects/project-1/git/status")) {
          return jsonResponse(gitStatusFixture());
        }
        if (url.startsWith("/api/projects/project-1/commits")) {
          return jsonResponse([commitFixture()]);
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByLabelText("Git target"));

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Main checkout - mainE:/repo/console",
      "feature/a - E:/repo/console/.worktrees/feature-aE:/repo/console/.worktrees/feature-a"
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Commits" }));
    await screen.findByLabelText("Commit target");

    expect(
      Array.from((screen.getByLabelText("Commit target") as HTMLSelectElement).options).map((option) => option.value)
    ).toEqual(["E:/repo/console", "E:/repo/console/.worktrees/feature-a"]);
  });

  it("filters Git target options with search before switching targets", async () => {
    const featurePath = "E:/repo/console/.worktrees/feature-a";
    const schedulePath = "E:/repo/console/.worktrees/schedule-fix";
    const project = projectFixture({
      worktrees: [
        {
          path: featurePath,
          head: "def456",
          shortHead: "def456",
          branch: "feature/a",
          detached: false,
          clean: false,
          dirtyFiles: 1,
          changes: []
        },
        {
          path: schedulePath,
          head: "fed321",
          shortHead: "fed321",
          branch: "codex/schedule-fix",
          detached: false,
          clean: true,
          dirtyFiles: 0,
          changes: []
        }
      ]
    });
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture([project]));
        }
        if (url.includes("path=E%3A%2Frepo%2Fconsole%2F.worktrees%2Ffeature-a")) {
          return jsonResponse(
            gitStatusFixture({
              worktreePath: featurePath,
              branch: "feature/a",
              changes: {
                unstaged: [{ code: "M", path: "src/feature.ts", raw: " M src/feature.ts" }],
                staged: []
              }
            })
          );
        }
        if (url.startsWith("/api/projects/project-1/git/status")) {
          return jsonResponse(gitStatusFixture());
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByLabelText("Git target"));
    const searchInput = await screen.findByLabelText("Search Git target");

    fireEvent.change(searchInput, { target: { value: "feature/a" } });

    expect(screen.getByRole("option", { name: /feature\/a/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /schedule-fix/ })).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: /feature\/a/ }));

    await waitFor(() => {
      expect(gitPanelText(container)).toContain("feature/a");
      expect(gitPanelText(container)).toContain("src/feature.ts");
    });
    expect(requestedUrls.some((url) => url.includes("path=E%3A%2Frepo%2Fconsole%2F.worktrees%2Ffeature-a"))).toBe(
      true
    );
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

  it("toggles line wrapping for diff previews", async () => {
    const status = gitStatusFixture({
      changes: {
        unstaged: [{ code: "M", path: "src/App.tsx", raw: " M src/App.tsx" }],
        staged: []
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
              diff: "diff --git a/src/App.tsx b/src/App.tsx\n@@ -1 +1 @@\n-const oldValue = 'very-long-line-that-would-normally-scroll';\n+const newValue = 'very-long-line-that-can-wrap-inside-the-diff-panel';"
            })
          );
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByText("src/App.tsx"));

    const preview = await screen.findByLabelText("Diff preview for src/App.tsx");
    expect(preview.className).not.toContain("wrap-lines");

    fireEvent.click(screen.getByRole("button", { name: "Wrap diff lines" }));
    expect(preview.className).toContain("wrap-lines");

    fireEvent.click(screen.getByRole("button", { name: "Disable diff line wrapping" }));
    expect(preview.className).not.toContain("wrap-lines");
  });

  it("confirms before discarding an individual changed file", async () => {
    const dirtyStatus = gitStatusFixture({
      changes: {
        unstaged: [{ code: "M", path: "src/App.tsx", raw: " M src/App.tsx" }],
        staged: []
      }
    });
    const cleanStatus = gitStatusFixture({
      clean: true,
      changes: {
        unstaged: [],
        staged: []
      }
    });
    const discardRequests: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture());
        }
        if (url.startsWith("/api/projects/project-1/git/status")) {
          return jsonResponse(dirtyStatus);
        }
        if (url === "/api/projects/project-1/git/discard") {
          discardRequests.push(init ?? {});
          return jsonResponse({ ok: true, status: cleanStatus });
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("src/App.tsx");

    fireEvent.click(screen.getByRole("button", { name: "Confirm Discard" }));

    await waitFor(() => expect(discardRequests).toHaveLength(1));
    expect(JSON.parse(String(discardRequests[0].body))).toEqual({
      path: "E:/repo/console",
      files: ["src/App.tsx"]
    });
    expect(gitPanelText(container)).toContain("No unstaged files.");
  });

  it("confirms stash and sends only selected files", async () => {
    const dirtyStatus = gitStatusFixture({
      changes: {
        unstaged: [
          { code: "M", path: "src/App.tsx", raw: " M src/App.tsx" },
          { code: "??", path: "src/keep-local.ts", raw: "?? src/keep-local.ts" }
        ],
        staged: []
      }
    });
    const remainingStatus = gitStatusFixture({
      changes: {
        unstaged: [{ code: "??", path: "src/keep-local.ts", raw: "?? src/keep-local.ts" }],
        staged: []
      }
    });
    const stashRequests: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture());
        }
        if (url.startsWith("/api/projects/project-1/git/status")) {
          return jsonResponse(dirtyStatus);
        }
        if (url === "/api/projects/project-1/git/stash") {
          stashRequests.push(init ?? {});
          return jsonResponse({ ok: true, status: remainingStatus });
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stash changes" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("src/App.tsx");
    expect(dialog.textContent).toContain("src/keep-local.ts");
    expect(stashRequests).toHaveLength(0);

    fireEvent.click(screen.getByLabelText("src/keep-local.ts"));
    fireEvent.click(screen.getByRole("button", { name: "Stash selected files" }));

    await waitFor(() => expect(stashRequests).toHaveLength(1));
    expect(JSON.parse(String(stashRequests[0].body))).toEqual({
      path: "E:/repo/console",
      files: ["src/App.tsx"]
    });
    expect(gitPanelText(container)).toContain("src/keep-local.ts");
    expect(gitPanelText(container)).not.toContain("src/App.tsx");
  });

  it("refreshes git status instead of showing stale worktree diff errors", async () => {
    const status = gitStatusFixture({
      changes: {
        unstaged: [{ code: "M", path: "src/App.tsx", raw: " M src/App.tsx" }],
        staged: []
      }
    });
    const statusRequests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture());
        }
        if (url.startsWith("/api/projects/project-1/git/status")) {
          statusRequests.push(url);
          return jsonResponse(status);
        }
        if (url.startsWith("/api/projects/project-1/worktrees/diff")) {
          return jsonResponse({ error: "Worktree not found." }, 404);
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    fireEvent.click(await screen.findByText("src/App.tsx"));

    await waitFor(() => expect(statusRequests).toHaveLength(2));

    expect(gitPanelText(container)).toContain("Select a file to preview its diff.");
    expect(gitPanelText(container)).not.toContain("Worktree not found.");
  });

  it("switches Git operations between the main checkout and project worktrees", async () => {
    const project = projectFixture({
      worktrees: [
        {
          path: "E:/repo/console/.worktrees/feature-a",
          head: "abc123",
          shortHead: "abc123",
          branch: "feature/a",
          detached: false,
          clean: false,
          dirtyFiles: 1,
          changes: []
        }
      ]
    });
    const mainStatus = gitStatusFixture({
      worktreePath: project.path,
      branch: "main",
      changes: { unstaged: [], staged: [] }
    });
    const featureStatus = gitStatusFixture({
      worktreePath: "E:/repo/console/.worktrees/feature-a",
      branch: "feature/a",
      upstream: "origin/feature/a",
      changes: {
        unstaged: [{ code: "M", path: "src/feature.ts", raw: " M src/feature.ts" }],
        staged: []
      }
    });
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture([project]));
        }
        if (url.includes("path=E%3A%2Frepo%2Fconsole%2F.worktrees%2Ffeature-a")) {
          return jsonResponse(featureStatus);
        }
        if (url.includes("path=E%3A%2Frepo%2Fconsole")) {
          return jsonResponse(mainStatus);
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    await waitFor(() => expect(gitPanelText(container)).toContain("main"));

    fireEvent.click(screen.getByLabelText("Git target"));
    fireEvent.click(screen.getByRole("option", { name: /feature\/a/ }));

    await waitFor(() => {
      expect(gitPanelText(container)).toContain("feature/a");
      expect(gitPanelText(container)).toContain("src/feature.ts");
    });
    expect(requestedUrls.some((url) => url.includes("path=E%3A%2Frepo%2Fconsole%2F.worktrees%2Ffeature-a"))).toBe(
      true
    );
  });

  it("renders staged and unstaged files in one changed-files column", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture());
        }
        if (url.startsWith("/api/projects/project-1/git/status")) {
          return jsonResponse(
            gitStatusFixture({
              changes: {
                unstaged: [{ code: "M", path: "src/unstaged.ts", raw: " M src/unstaged.ts" }],
                staged: [{ code: "A", path: "src/staged.ts", raw: "A  src/staged.ts" }]
              }
            })
          );
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));

    await waitFor(() => {
      const workspace = container.querySelector(".git-workspace");
      expect(workspace?.querySelectorAll(".git-changes-column")).toHaveLength(1);
      expect(workspace?.querySelectorAll(".git-commit-column")).toHaveLength(0);
      expect(workspace?.children).toHaveLength(2);
      expect(gitPanelText(container)).toContain("Changed files");
      expect(gitPanelText(container)).toContain("Unstaged");
      expect(gitPanelText(container)).toContain("Staged");
      expect(gitPanelText(container)).toContain("src/unstaged.ts");
      expect(gitPanelText(container)).toContain("src/staged.ts");
    });
  });

  it("places the commit form below the staged group", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture());
        }
        if (url.startsWith("/api/projects/project-1/git/status")) {
          return jsonResponse(
            gitStatusFixture({
              changes: {
                unstaged: [],
                staged: [{ code: "A", path: "src/staged.ts", raw: "A  src/staged.ts" }]
              }
            })
          );
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));

    await waitFor(() => {
      const changesColumn = container.querySelector(".git-changes-column");
      const groups = changesColumn?.querySelectorAll(".git-change-group");
      const commitForm = changesColumn?.querySelector(".git-commit-form");
      expect(groups).toHaveLength(2);
      expect(commitForm).not.toBeNull();
      expect(groups?.[1]?.compareDocumentPosition(commitForm as Element) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
  });

  it("can expand project detail to the project page left edge", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/projects") {
          return jsonResponse(dashboardFixture());
        }

        return jsonResponse({ error: `Unexpected request: ${String(input)}` }, 500);
      })
    );

    const { container } = render(createElement(App));

    await screen.findByRole("heading", { name: "Console" });
    fireEvent.click(screen.getByRole("button", { name: "Expand project details" }));

    await waitFor(() => {
      expect((container.querySelector(".app-body") as HTMLElement).style.getPropertyValue("--inspector-width")).toBe(
        "1390px"
      );
    });
    expect(screen.getByRole("button", { name: "Restore project details width" })).not.toBeNull();
  });

  it("restores the project detail width after expanding from an auto-widened tab", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/projects") {
          return jsonResponse(dashboardFixture());
        }
        if (url.startsWith("/api/projects/project-1/git/status")) {
          return jsonResponse(gitStatusFixture());
        }

        return jsonResponse({ error: `Unexpected request: ${url}` }, 500);
      })
    );

    const { container } = render(createElement(App));
    const appBody = container.querySelector(".app-body") as HTMLElement;

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));
    await waitFor(() => {
      expect(appBody.style.getPropertyValue("--inspector-width")).toBe("928px");
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand project details" }));
    await waitFor(() => {
      expect(appBody.style.getPropertyValue("--inspector-width")).toBe("1390px");
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore project details width" }));
    await waitFor(() => {
      expect(appBody.style.getPropertyValue("--inspector-width")).toBe("640px");
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

function commitFixture(overrides: Partial<RecentCommit> = {}): RecentCommit {
  return {
    hash: "abc1234",
    subject: "Commit subject",
    author: "Ada",
    relativeTime: "1 minute ago",
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
