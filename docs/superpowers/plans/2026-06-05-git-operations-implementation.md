# Git Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a wide `Git` tab for safe daily Git operations: fetch, pull, push, stage, unstage, commit, and stash.

**Architecture:** Keep Git command execution on the Express backend using `execFile`-based helpers in `src/server/git.ts`. Add a thin route orchestration layer for target validation and operation safety, then expose typed client calls to a focused React `GitPanel`. The UI reuses the existing inspector focused-width behavior and bounded diff preview patterns, with explicit CSS containment rules to avoid horizontal overflow.

**Tech Stack:** React 19, TypeScript, Express 5, Vitest, supertest, local Git CLI.

---

## Scope Check

The approved spec is a single subsystem: daily Git operations for registered projects and visible worktrees. It intentionally excludes merge, rebase, checkout, branch creation, force push, conflict editing, stash apply/drop, remote setup, credential management, and Git LFS-specific flows.

## File Structure

- Modify `src/shared/types.ts`
  - Add Git operation response types used by the API and UI.
  - Add activity target type support for Git operations if needed.
- Modify `src/server/git.ts`
  - Add parsing helpers for staged/unstaged status, stash list output, and last fetch metadata.
  - Add `execFile` Git helpers for fetch, pull, push, stage, unstage, commit, and stash.
- Create `src/server/gitOperations.ts`
  - Own API-level safety validation: resolve registered project target, verify target worktree belongs to the current snapshot, validate file paths against current status, build operation status responses, and record operation labels.
  - Keep `src/server/app.ts` from absorbing another large set of route-specific helper functions.
- Modify `src/server/app.ts`
  - Register `/api/projects/:id/git/*` read and mutation routes.
  - Delegate path/file validation and Git execution to `gitOperations.ts`.
- Modify `src/lib/api.ts`
  - Add typed client functions for Git status, diff, stashes, and mutations.
- Create `src/lib/git-ui.ts`
  - Add pure UI helpers for staged/unstaged split labels, disabled states, compact labels, and wide layout class naming.
- Modify `src/lib/diff-ui.ts`
  - Generalize focused inspector width naming if needed, while preserving existing `focusedChangesInspectorWidth` export for current tests.
- Modify `src/App.tsx`
  - Add the `git` inspector tab.
  - Add wide focus behavior for the Git tab.
  - Add `GitPanel`, `SyncCard`, `StashCard`, `GitChangesList`, `GitDiffPreview`, and `CommitBox`.
- Modify `src/styles.css`
  - Add contained wide Git layout styles using `minmax(0, ...)`, `min-width: 0`, ellipsis, and compact action buttons.
- Add or modify tests:
  - `tests/git.test.ts`
  - `tests/git-operations.test.ts`
  - `tests/api.test.ts`
  - `tests/git-ui.test.ts`
  - `tests/diff-ui.test.ts`
- Modify docs:
  - `README.md`
  - `docs/architecture.md`
  - `AGENTS.md`

---

### Task 1: Shared Types And Git Status Parsing

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/git.ts`
- Test: `tests/git.test.ts`

- [ ] **Step 1: Write failing tests for staged and unstaged status classification**

Add tests to `tests/git.test.ts`:

```ts
import { splitGitOperationChanges } from "../src/server/git";

describe("splitGitOperationChanges", () => {
  it("splits staged and unstaged changes from porcelain status", () => {
    const changes = [
      { code: "M", path: "src/staged.ts", raw: "M  src/staged.ts" },
      { code: "M", path: "src/unstaged.ts", raw: " M src/unstaged.ts" },
      { code: "M", path: "src/both.ts", raw: "MM src/both.ts" },
      { code: "??", path: "src/new.ts", raw: "?? src/new.ts" }
    ];

    expect(splitGitOperationChanges(changes)).toEqual({
      staged: [
        { code: "M", path: "src/staged.ts", raw: "M  src/staged.ts" },
        { code: "M", path: "src/both.ts", raw: "MM src/both.ts" }
      ],
      unstaged: [
        { code: "M", path: "src/unstaged.ts", raw: " M src/unstaged.ts" },
        { code: "M", path: "src/both.ts", raw: "MM src/both.ts" },
        { code: "??", path: "src/new.ts", raw: "?? src/new.ts" }
      ]
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npm test -- tests/git.test.ts
```

Expected: FAIL because `splitGitOperationChanges` is not exported.

- [ ] **Step 3: Add shared Git operation types**

Add to `src/shared/types.ts`:

```ts
export type GitOperationChangeGroups = {
  staged: WorktreeChange[];
  unstaged: WorktreeChange[];
};

export type GitStashEntry = {
  index: number;
  name: string;
  branch: string | null;
  message: string;
};

export type GitOperationStatus = {
  projectId: string;
  worktreePath: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  changes: GitOperationChangeGroups;
  stashes: GitStashEntry[];
};

export type GitOperationResponse = {
  ok: true;
  status: GitOperationStatus;
};
```

If Activity needs a Git-specific target, extend:

```ts
export type ActivityTargetType = "project" | "worktree" | "branch" | "service" | "service-group" | "git";
```

- [ ] **Step 4: Implement the status split helper**

Add to `src/server/git.ts`:

```ts
import type { GitOperationChangeGroups } from "../shared/types";

export function splitGitOperationChanges(changes: WorktreeChange[]): GitOperationChangeGroups {
  return {
    staged: changes.filter(hasStagedChange),
    unstaged: changes.filter((change) => hasUnstagedChange(change) || isUntrackedChange(change))
  };
}
```

The existing private `hasStagedChange`, `hasUnstagedChange`, and `isUntrackedChange` helpers already encode the correct XY status behavior.

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```powershell
npm test -- tests/git.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/shared/types.ts src/server/git.ts tests/git.test.ts
git commit -m "Add git operation status types"
```

---

### Task 2: Backend Git Command Helpers

**Files:**
- Modify: `src/server/git.ts`
- Test: `tests/git-operations.test.ts`

- [ ] **Step 1: Create failing tests for commit, stash, and file staging helpers**

Create `tests/git-operations.test.ts` with temp Git repositories:

```ts
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  commitStagedFiles,
  createStash,
  readStashes,
  stageFiles,
  unstageFiles
} from "../src/server/git";

const execFileAsync = promisify(execFile);
let tempDir: string;
let repoPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "worktree-console-gitops-"));
  repoPath = join(tempDir, "repo");
  await git(tempDir, ["init", repoPath]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Test User"]);
  await writeFile(join(repoPath, "README.md"), "base\n");
  await git(repoPath, ["add", "."]);
  await git(repoPath, ["commit", "-m", "Initial commit"]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("git operation helpers", () => {
  it("stages, unstages, and commits files without shell interpolation", async () => {
    await writeFile(join(repoPath, "README.md"), "changed\n");
    await stageFiles(repoPath, ["README.md"]);
    expect((await git(repoPath, ["diff", "--cached", "--name-only"])).stdout.trim()).toBe("README.md");

    await unstageFiles(repoPath, ["README.md"]);
    expect((await git(repoPath, ["diff", "--cached", "--name-only"])).stdout.trim()).toBe("");

    await stageFiles(repoPath, ["README.md"]);
    await commitStagedFiles(repoPath, "Update readme; echo nope");
    const log = await git(repoPath, ["log", "-1", "--pretty=%s"]);
    expect(log.stdout.trim()).toBe("Update readme; echo nope");
  });

  it("creates and reads stashes", async () => {
    await writeFile(join(repoPath, "README.md"), "stash me\n");
    await createStash(repoPath, "draft changes");
    const stashes = await readStashes(repoPath);
    expect(stashes[0]).toMatchObject({ index: 0, message: expect.stringContaining("draft changes") });
  });
});

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd, windowsHide: true, timeout: 12000 });
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npm test -- tests/git-operations.test.ts
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement Git command helpers**

Add to `src/server/git.ts`:

```ts
export async function fetchRepository(path: string): Promise<void> {
  await git(path, ["fetch", "--prune"]);
}

export async function pullRepository(path: string): Promise<void> {
  await git(path, ["pull", "--ff-only"]);
}

export async function pushRepository(path: string): Promise<void> {
  await git(path, ["push"]);
}

export async function stageFiles(path: string, filePaths: string[]): Promise<void> {
  await git(path, ["add", "--", ...filePaths]);
}

export async function unstageFiles(path: string, filePaths: string[]): Promise<void> {
  await git(path, ["restore", "--staged", "--", ...filePaths]);
}

export async function commitStagedFiles(path: string, message: string): Promise<void> {
  await git(path, ["commit", "-m", message]);
}

export async function createStash(path: string, message?: string): Promise<void> {
  const args = ["stash", "push"];
  if (message?.trim()) {
    args.push("-m", message.trim());
  }
  await git(path, args);
}
```

Also add `readStashes` plus parser:

```ts
export function parseStashList(output: string): GitStashEntry[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = "", subject = ""] = line.split("\u001f");
      const index = Number(name.match(/stash@\{(\d+)\}/)?.[1] ?? 0);
      const subjectMatch = subject.match(/^On (?<branch>[^:]+):\s*(?<message>.*)$/);
      return {
        index,
        name,
        branch: subjectMatch?.groups?.branch ?? null,
        message: subjectMatch?.groups?.message ?? subject
      };
    });
}

export async function readStashes(path: string): Promise<GitStashEntry[]> {
  const { stdout } = await git(path, ["stash", "list", "--format=%gd%x1f%gs"]);
  return parseStashList(stdout);
}
```

- [ ] **Step 4: Run helper tests**

Run:

```powershell
npm test -- tests/git-operations.test.ts tests/git.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/server/git.ts tests/git-operations.test.ts
git commit -m "Add git operation command helpers"
```

---

### Task 3: Git Operation API Routes And Safety Validation

**Files:**
- Create: `src/server/gitOperations.ts`
- Modify: `src/server/app.ts`
- Test: `tests/api.test.ts`

- [ ] **Step 1: Write failing API tests for target and operation safety**

Add tests to `tests/api.test.ts`:

```ts
it("returns git operation status for a registered worktree", async () => {
  const repoPath = join(tempDir, "repo");
  await createGitRepo(repoPath);
  await writeFileText(repoPath, "README.md", "changed\n");
  await git(repoPath, ["add", "README.md"]);
  await writeFileText(repoPath, "src/App.tsx", "unstaged\n");

  const registry = new ProjectRegistry(join(tempDir, "projects.json"));
  const app = createApp({ activityLog: new ActivityLog(join(tempDir, "activity.json")), registry });
  const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

  const response = await request(app)
    .get(`/api/projects/${project.id}/git/status`)
    .query({ path: repoPath })
    .expect(200);

  expect(response.body).toMatchObject({
    projectId: project.id,
    worktreePath: expect.any(String),
    changes: {
      staged: [expect.objectContaining({ path: "README.md" })],
      unstaged: [expect.objectContaining({ path: "src/App.tsx" })]
    }
  });
});

it("rejects staging files not reported by git status", async () => {
  const repoPath = join(tempDir, "repo");
  await createGitRepo(repoPath);
  const registry = new ProjectRegistry(join(tempDir, "projects.json"));
  const app = createApp({ activityLog: new ActivityLog(join(tempDir, "activity.json")), registry });
  const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

  await request(app)
    .post(`/api/projects/${project.id}/git/stage`)
    .send({ path: repoPath, files: ["not-reported.txt"] })
    .expect(400);
});

it("records failed git operations in activity", async () => {
  const repoPath = join(tempDir, "repo");
  await createGitRepo(repoPath);
  await writeFileText(repoPath, "README.md", "dirty\n");
  const activityLog = new ActivityLog(join(tempDir, "activity.json"));
  const registry = new ProjectRegistry(join(tempDir, "projects.json"));
  const app = createApp({ activityLog, registry });
  const project = await registry.addProject({ name: "Repo", path: repoPath, tags: [] });

  await request(app).post(`/api/projects/${project.id}/git/pull`).send({ path: repoPath }).expect(409);

  const activity = await request(app).get("/api/activity").expect(200);
  expect(activity.body.events[0]).toMatchObject({
    action: "git.pull",
    status: "failed",
    targetType: "git"
  });
});
```

- [ ] **Step 2: Run focused API tests and verify they fail**

Run:

```powershell
npm test -- tests/api.test.ts
```

Expected: FAIL because `/git/*` routes do not exist.

- [ ] **Step 3: Create route orchestration module**

Create `src/server/gitOperations.ts`:

```ts
import { realpathSync } from "node:fs";

import {
  commitStagedFiles,
  createStash,
  fetchRepository,
  pullRepository,
  pushRepository,
  readBranchStatus,
  readStashes,
  readWorktreeChanges,
  splitGitOperationChanges,
  stageFiles,
  unstageFiles
} from "./git";
import type { ProjectSnapshot, RegisteredProject, WorktreeChange, GitOperationStatus } from "../shared/types";

export class GitOperationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function buildGitOperationStatus(
  project: RegisteredProject,
  snapshot: ProjectSnapshot,
  requestedPath?: string
): Promise<GitOperationStatus> {
  const targetPath = resolveGitTargetPath(project, snapshot, requestedPath);
  const [branch, changes, stashes] = await Promise.all([
    readBranchStatus(targetPath),
    readWorktreeChanges(targetPath),
    readStashes(targetPath)
  ]);

  return {
    projectId: project.id,
    worktreePath: targetPath,
    branch: branch.branch,
    upstream: branch.upstream,
    ahead: branch.ahead,
    behind: branch.behind,
    clean: branch.clean,
    changes: splitGitOperationChanges(changes),
    stashes
  };
}

export function resolveGitTargetPath(project: RegisteredProject, snapshot: ProjectSnapshot, requestedPath?: string): string {
  const path = requestedPath?.trim() || project.path;
  const match = snapshot.worktrees.find((worktree) => samePath(worktree.path, path));
  if (!match) {
    throw new GitOperationError(404, "Git target worktree was not found in this registered project.");
  }
  return match.path;
}

export function assertFilesReported(files: string[], changes: WorktreeChange[], label: string): void {
  const reported = new Set(changes.map((change) => change.path));
  const missing = files.filter((file) => !reported.has(file));
  if (missing.length > 0) {
    throw new GitOperationError(400, `${label} file is not in the current Git status: ${missing.join(", ")}.`);
  }
}

export function assertCanPull(status: GitOperationStatus): void {
  if (!status.upstream) throw new GitOperationError(409, "Cannot pull because this branch has no upstream.");
  if (!status.clean) throw new GitOperationError(409, "Cannot pull while local changes are present.");
  if (status.ahead > 0 && status.behind > 0) throw new GitOperationError(409, "Cannot pull a diverged branch from the console.");
}

export function assertCanPush(status: GitOperationStatus): void {
  if (!status.upstream) throw new GitOperationError(409, "Cannot push because this branch has no upstream.");
  if (status.ahead <= 0) throw new GitOperationError(409, "There are no local commits to push.");
  if (status.behind > 0) throw new GitOperationError(409, "Cannot push while the branch is behind upstream.");
}

function samePath(left: string, right: string) {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string) {
  try {
    return realpathSync.native(path).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  } catch {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }
}
```

Also expose thin operation wrappers or keep command calls inside `app.ts` with these validators.

- [ ] **Step 4: Add routes to `src/server/app.ts`**

Import the new helpers and add routes before the worktree diff/delete routes:

```ts
app.get("/api/projects/:id/git/status", async (request, response, next) => {
  try {
    const project = await findProject(registry, request.params.id);
    const snapshot = await snapshotProject(project, serviceManager);
    response.json(await buildGitOperationStatus(project, snapshot, String(request.query.path ?? "")));
  } catch (error) {
    next(mapGitOperationError(error));
  }
});
```

For mutations, follow this pattern:

```ts
app.post("/api/projects/:id/git/stage", async (request, response, next) => {
  let project: RegisteredProject | null = null;
  try {
    project = await findProject(registry, request.params.id);
    const snapshot = await snapshotProject(project, serviceManager);
    const status = await buildGitOperationStatus(project, snapshot, String(request.body?.path ?? ""));
    const files = parseGitFiles(request.body);
    assertFilesReported(files, status.changes.unstaged, "Stage");
    await stageFiles(status.worktreePath, files);
    await recordGitActivity(activityLog, project, "stage", status.worktreePath, files.join(", "));
    response.status(202).json({ ok: true, status: await buildGitOperationStatus(project, snapshot, status.worktreePath) });
  } catch (error) {
    if (project) {
      await recordGitActivity(activityLog, project, "stage", String(request.body?.path ?? ""), (error as Error).message, "failed");
    }
    next(mapGitOperationError(error));
  }
});
```

Keep helpers `parseGitFiles`, `recordGitActivity`, and `mapGitOperationError` small and local to `app.ts`, or move them into `gitOperations.ts` if route code gets noisy.

- [ ] **Step 5: Run API tests**

Run:

```powershell
npm test -- tests/api.test.ts tests/git-operations.test.ts tests/git.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/server/app.ts src/server/gitOperations.ts tests/api.test.ts
git commit -m "Add git operation API routes"
```

---

### Task 4: Client API And Pure UI Helpers

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/lib/git-ui.ts`
- Test: `tests/git-ui.test.ts`
- Test: `tests/diff-ui.test.ts`

- [ ] **Step 1: Write failing UI helper tests**

Create `tests/git-ui.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  commitDisabledReason,
  gitPanelLayoutClass,
  gitSyncDisabledReason,
  shortGitActionLabel
} from "../src/lib/git-ui";

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
    expect(gitSyncDisabledReason("pull", { upstream: null, clean: true, ahead: 0, behind: 0 })).toBe("No upstream branch.");
    expect(gitSyncDisabledReason("pull", { upstream: "origin/main", clean: false, ahead: 0, behind: 1 })).toBe("Commit or stash local changes first.");
    expect(gitSyncDisabledReason("push", { upstream: "origin/main", clean: true, ahead: 0, behind: 0 })).toBe("No local commits to push.");
  });
});
```

- [ ] **Step 2: Run focused UI tests and verify failure**

Run:

```powershell
npm test -- tests/git-ui.test.ts
```

Expected: FAIL because `src/lib/git-ui.ts` does not exist.

- [ ] **Step 3: Implement UI helpers**

Create `src/lib/git-ui.ts`:

```ts
export type GitSyncAction = "fetch" | "pull" | "push";

export function gitPanelLayoutClass(): string {
  return "section git-panel git-panel-wide";
}

export function shortGitActionLabel(action: "stage" | "unstage"): string {
  return action === "stage" ? "Stage" : "Undo";
}

export function commitDisabledReason({ stagedCount, message }: { stagedCount: number; message: string }): string | null {
  if (stagedCount <= 0) return "Stage files before committing.";
  if (message.trim().length === 0) return "Write a commit message.";
  return null;
}

export function gitSyncDisabledReason(
  action: GitSyncAction,
  status: { upstream: string | null; clean: boolean; ahead: number; behind: number }
): string | null {
  if (action === "fetch") return null;
  if (!status.upstream) return "No upstream branch.";
  if (action === "pull") {
    if (!status.clean) return "Commit or stash local changes first.";
    if (status.ahead > 0 && status.behind > 0) return "Diverged branch requires terminal review.";
    return null;
  }
  if (status.ahead <= 0) return "No local commits to push.";
  if (status.behind > 0) return "Pull or review upstream changes first.";
  return null;
}
```

- [ ] **Step 4: Add typed client API calls**

Modify `src/lib/api.ts` imports:

```ts
import type { GitOperationResponse, GitOperationStatus, WorktreeDiffResponse } from "../shared/types";
```

Add:

```ts
export async function getGitStatus(projectId: string, worktreePath: string): Promise<GitOperationStatus> {
  const params = new URLSearchParams({ path: worktreePath });
  return request<GitOperationStatus>(`/api/projects/${projectId}/git/status?${params.toString()}`);
}

export async function runGitOperation(
  projectId: string,
  action: "fetch" | "pull" | "push" | "stage" | "unstage" | "commit" | "stash",
  body: Record<string, unknown>
): Promise<GitOperationResponse> {
  return request<GitOperationResponse>(`/api/projects/${projectId}/git/${action}`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
```

- [ ] **Step 5: Run helper tests**

Run:

```powershell
npm test -- tests/git-ui.test.ts tests/diff-ui.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/api.ts src/lib/git-ui.ts tests/git-ui.test.ts tests/diff-ui.test.ts
git commit -m "Add git panel client helpers"
```

---

### Task 5: Wide Git Tab UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `tests/git-ui.test.ts`

- [ ] **Step 1: Add failing helper expectation for focused inspector width**

If keeping the width helper in `diff-ui.ts`, add to `tests/diff-ui.test.ts`:

```ts
it("uses the same readable focused width for Git operations", () => {
  expect(focusedChangesInspectorWidth({ currentWidth: 640, viewportWidth: 1600 })).toBe(928);
});
```

This may already pass; if so, it documents the width contract.

- [ ] **Step 2: Add `git` to inspector tab state**

Modify `src/App.tsx`:

```ts
type InspectorTab = "trees" | "branches" | "commits" | "services" | "git";
```

Add segment:

```tsx
<SegmentButton active={tab === "git"} onClick={() => onTabChange("git")}>
  Git
</SegmentButton>
```

Change the focus effect:

```ts
useEffect(() => {
  onChangesFocusChange((tab === "trees" && Boolean(selectedWorktreePath)) || tab === "git");
}, [onChangesFocusChange, selectedWorktreePath, tab]);
```

This preserves the existing automatic expansion behavior and makes Git tab wide by default unless the user manually resized the inspector.

- [ ] **Step 3: Add the Git panel shell**

In `src/App.tsx`, add:

```tsx
{tab === "git" ? <GitPanel project={project} onRefresh={onGitChanged} /> : null}
```

Add prop:

```ts
onGitChanged: (message: string) => Promise<void>;
```

Wire it from the parent with:

```tsx
onGitChanged={async (message) => {
  setNotice(message);
  await refreshAfterOperation();
}}
```

- [ ] **Step 4: Implement `GitPanel` with status loading**

Add a component in `src/App.tsx` near `CommitPanel`:

```tsx
function GitPanel({ onGitChanged, project }: { project: ProjectSnapshot; onGitChanged: (message: string) => Promise<void> }) {
  const targetPath = project.path;
  const [status, setStatus] = useState<GitOperationStatus | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getGitStatus(project.id, targetPath)
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project.id, targetPath]);

  return (
    <section className={gitPanelLayoutClass()}>
      {/* SyncCard, StashCard, changes columns, and commit box go here. */}
    </section>
  );
}
```

Import:

```ts
import { getGitStatus, getWorktreeDiff, runGitOperation } from "./lib/api";
import { commitDisabledReason, gitPanelLayoutClass, gitSyncDisabledReason, shortGitActionLabel } from "./lib/git-ui";
```

- [ ] **Step 5: Implement Sync and Stash cards**

Add buttons that call:

```ts
await runGitOperation(project.id, "fetch", { path: status.worktreePath });
await runGitOperation(project.id, "pull", { path: status.worktreePath });
await runGitOperation(project.id, "push", { path: status.worktreePath });
await runGitOperation(project.id, "stash", { path: status.worktreePath });
```

After each successful mutation:

```ts
setStatus(result.status);
await onGitChanged(`Git ${action} completed for ${project.name}.`);
```

Use `gitSyncDisabledReason` for disabled button titles.

- [ ] **Step 6: Implement staged/unstaged lists and commit**

Use the approved fixed-width layout:

```tsx
<div className="git-workspace">
  <GitChangesList title="Unstaged" action="stage" changes={status.changes.unstaged} />
  <GitDiffPreview ... />
  <GitChangesList title="Staged" action="unstage" changes={status.changes.staged} />
</div>
```

Stage and unstage:

```ts
await runGitOperation(project.id, "stage", { path: status.worktreePath, files: [filePath] });
await runGitOperation(project.id, "unstage", { path: status.worktreePath, files: [filePath] });
```

Commit:

```ts
const disabledReason = commitDisabledReason({ stagedCount: status.changes.staged.length, message });
if (disabledReason) return;
const result = await runGitOperation(project.id, "commit", { path: status.worktreePath, message });
setMessage("");
setStatus(result.status);
await onGitChanged(`Committed ${project.name}.`);
```

- [ ] **Step 7: Add CSS containment**

Add to `src/styles.css`:

```css
.git-panel {
  display: grid;
  min-width: 0;
  gap: 10px;
}

.git-summary-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(220px, 0.75fr);
  gap: 10px;
  min-width: 0;
}

.git-workspace {
  display: grid;
  grid-template-columns: minmax(190px, 0.8fr) minmax(260px, 1.15fr) minmax(220px, 0.9fr);
  gap: 10px;
  min-width: 0;
}

.git-card,
.git-column,
.git-diff {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.76);
  overflow: hidden;
}

.git-file-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.git-file-row .mono,
.git-diff-file {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .git-summary-grid,
  .git-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 8: Run build and browser check**

Run:

```powershell
npm test -- tests/git-ui.test.ts tests/diff-ui.test.ts
npm run build
```

Then open `http://127.0.0.1:5273/` and verify:

- `Git` tab appears.
- Inspector expands when `Git` tab is active.
- No horizontal overflow in the fixed wide layout.
- Buttons show disabled states when status says no upstream/no staged files/no commit message.

- [ ] **Step 9: Commit**

```powershell
git add src/App.tsx src/styles.css tests/git-ui.test.ts tests/diff-ui.test.ts
git commit -m "Add wide git operations panel"
```

---

### Task 6: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update README feature list and safety section**

Add Git operations to `README.md`:

```md
- Run daily Git operations from a wide project Git tab: fetch, pull, push, stage, unstage, commit, and stash.
```

Add safety notes:

```md
Git operation controls validate the selected worktree against the registered project snapshot before running commands. Pull is blocked for dirty or diverged branches. Push does not support force push. Commit uses staged files only and requires a non-empty message.
```

- [ ] **Step 2: Update architecture docs**

Add `src/server/gitOperations.ts` to `docs/architecture.md` module list and describe the `/api/projects/:id/git/*` routes.

- [ ] **Step 3: Update AGENTS.md**

Add product boundaries:

```md
- Git operation routes must re-read registered project snapshots before running commands.
- Do not add force push, merge, rebase, checkout, stash apply/drop, or remote setup without a separate design.
- UI layouts for Git operations must keep `min-width: 0` containment and avoid horizontal overflow.
```

- [ ] **Step 4: Run full verification**

Run:

```powershell
npm test
npm run build
npm audit
git diff --check
```

Expected:

- All tests pass.
- Build succeeds.
- Audit reports `found 0 vulnerabilities`.
- `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Browser verification**

Use the in-app browser at `http://127.0.0.1:5273/`:

- Select a registered project.
- Open `Git` tab.
- Confirm wide focused mode is active.
- Confirm no panel or button overflows at the current browser width.
- Confirm staged/unstaged file rows truncate long paths instead of expanding the column.

- [ ] **Step 6: Commit**

```powershell
git add README.md docs/architecture.md AGENTS.md
git commit -m "Document git operation controls"
```

---

## Implementation Notes

- Keep `gitOperations.ts` focused on validation and route-safe operation orchestration. Keep raw Git command building in `git.ts`.
- Use `execFile` argument arrays only. Never build a shell command string from commit messages or file paths.
- Do not use native browser `confirm` or `alert`.
- Preserve the user's commit message when an operation fails.
- After mutation, update the Git panel from the operation response first; then trigger dashboard refresh in the background.
- If a command fails because of authentication, remote rejection, hooks, or conflicts, show Git's error message in an inline banner and record failed Activity.

## Final Verification Checklist

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm audit`
- [ ] `git diff --check`
- [ ] Browser check at `http://127.0.0.1:5273/`
- [ ] Commit history is focused and does not include local `data/`, temporary mockups, or logs.
