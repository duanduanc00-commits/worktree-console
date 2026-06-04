# Worktree Console Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the next three product increments in order: project health overview, richer Git worktree/branch detail, and service groups.

**Architecture:** Keep the backend as the source of truth for Git/service facts, add small domain helpers for derived summaries, and keep React views mostly presentational. Each milestone should ship independently with tests and a commit before starting the next milestone.

**Tech Stack:** React 19, TypeScript, Vite, Express, Vitest, supertest, local JSON registry files, native `git` and Windows process/port inspection.

---

## Scope And Order

Implement in this order:

1. Project Health Overview
2. Worktree and Branch Detail
3. Service Groups

Do not start milestone 2 until milestone 1 is tested, built, and committed. Do not start milestone 3 until milestone 2 is tested, built, and committed.

## File Structure

Expected new or modified files:

- Modify `src/shared/types.ts`
  - Add health issue types.
  - Add worktree diff/detail response types.
  - Add service group registry and snapshot types.
- Create `src/server/health.ts`
  - Pure functions that derive health issues from `ProjectSnapshot[]`.
- Modify `src/server/app.ts`
  - Add health summary to dashboard responses.
  - Add worktree diff/detail endpoints.
  - Add service group endpoints.
  - Record service group actions in activity log.
- Modify `src/server/git.ts`
  - Add bounded diff reading helpers.
  - Add branch detail/ahead-behind helpers if needed.
- Modify `src/server/registry.ts`
  - Persist `serviceGroups` on projects.
  - Normalize old registry files that lack groups.
- Modify `src/server/services.ts`
  - Add group start/stop/restart orchestration helpers only if app-level orchestration becomes too large.
- Modify `src/lib/api.ts`
  - Add client functions for health/diff/service group endpoints.
- Create `src/lib/health-ui.ts`
  - UI label/tone helpers for health issues.
- Create `src/lib/service-groups-ui.ts`
  - UI label/tone helpers for service groups.
- Modify `src/App.tsx`
  - Add Health sidebar view.
  - Add diff preview in worktree changes.
  - Add branch detail panel.
  - Add service group controls.
  - If this file becomes unwieldy during implementation, extract focused child components in the same task.
- Modify `src/styles.css`
  - Add health cards/list styling.
  - Add diff preview styling.
  - Add service group styling.
- Add tests:
  - `tests/health.test.ts`
  - `tests/health-ui.test.ts`
  - `tests/git.test.ts` additions
  - `tests/api.test.ts` additions
  - `tests/registry.test.ts` additions
  - `tests/service-groups-ui.test.ts`
- Modify `README.md`
  - Document health overview and service group runtime behavior.

---

## Milestone 1: Project Health Overview

### Task 1: Health Domain Model

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/server/health.ts`
- Test: `tests/health.test.ts`

- [ ] **Step 1: Write failing health tests**

Create `tests/health.test.ts`.

Test cases:

```ts
import { describe, expect, it } from "vitest";

import { buildHealthSummary } from "../src/server/health";
import type { ProjectSnapshot } from "../src/shared/types";

function project(overrides: Partial<ProjectSnapshot>): ProjectSnapshot {
  return {
    id: "p1",
    name: "Demo",
    path: "E:/demo",
    tags: [],
    pinned: false,
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    exists: true,
    isGitRepository: true,
    status: "clean",
    branch: { branch: "main", upstream: null, ahead: 0, behind: 0, dirtyFiles: 0, clean: true },
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
        status: "dirty",
        worktrees: [
          {
            path: "E:/demo/.worktrees/feature",
            head: "abc",
            shortHead: "abc1234",
            branch: "feature/demo",
            detached: false,
            clean: false,
            dirtyFiles: 3,
            changes: [],
            removal: {
              level: "blocked",
              label: "Dirty",
              reasons: ["Worktree has local changes."],
              canDelete: false
            }
          },
          {
            path: "E:/demo/.worktrees/old",
            head: "def",
            shortHead: "def1234",
            branch: "old/demo",
            detached: false,
            clean: true,
            dirtyFiles: 0,
            changes: [],
            removal: {
              level: "safe",
              label: "Safe to remove",
              reasons: ["Worktree is clean."],
              canDelete: true
            }
          }
        ],
        services: [
          {
            id: "s1",
            name: "API",
            cwd: "E:/demo",
            command: "npm run api",
            ports: [4217],
            healthUrl: null,
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:00.000Z",
            status: "stopped",
            startedByConsole: false,
            pid: null,
            portsStatus: [],
            logPreview: []
          }
        ]
      })
    ]);

    expect(summary.counts).toMatchObject({
      dirtyWorktrees: 1,
      cleanupCandidates: 1,
      stoppedServices: 1
    });
    expect(summary.issues.map((issue) => issue.kind)).toEqual(
      expect.arrayContaining(["dirty-worktree", "cleanup-candidate", "stopped-service"])
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/health.test.ts
```

Expected: FAIL because `src/server/health.ts` does not exist.

- [ ] **Step 3: Add shared health types**

In `src/shared/types.ts`, add:

```ts
export type HealthIssueKind =
  | "missing-project"
  | "dirty-project"
  | "dirty-worktree"
  | "cleanup-candidate"
  | "stopped-service"
  | "occupied-port";

export type HealthIssueSeverity = "info" | "warning" | "critical";

export type HealthIssue = {
  id: string;
  kind: HealthIssueKind;
  severity: HealthIssueSeverity;
  title: string;
  detail: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  targetType?: "project" | "worktree" | "branch" | "service" | "port";
  target?: string;
  actionLabel?: string;
};

export type HealthSummary = {
  counts: {
    critical: number;
    warning: number;
    info: number;
    dirtyProjects: number;
    dirtyWorktrees: number;
    cleanupCandidates: number;
    stoppedServices: number;
    occupiedPorts: number;
    missingProjects: number;
  };
  issues: HealthIssue[];
};
```

Add `health: HealthSummary` to `DashboardResponse`.

- [ ] **Step 4: Implement `buildHealthSummary`**

Create `src/server/health.ts`.

Implementation rules:

- Pure function only.
- No filesystem, no Git calls.
- Use `ProjectSnapshot[]` already built by `snapshotProject`.
- Limit issue list to a stable order:
  1. severity first: critical, warning, info
  2. within each severity: missing projects, occupied ports, dirty projects, dirty worktrees, stopped services, cleanup candidates
  3. keep project/worktree/service traversal stable within each category

Warning issues should not be buried below info-level cleanup items.

Skeleton:

```ts
import type { HealthIssue, HealthSummary, ProjectSnapshot } from "../shared/types";

export function buildHealthSummary(projects: ProjectSnapshot[]): HealthSummary {
  const issues: HealthIssue[] = [];

  for (const project of projects) {
    if (project.status === "missing") {
      issues.push(issue(project, "missing-project", "critical", "Missing project", project.path, "project", project.path));
    }

    if (project.status === "dirty") {
      issues.push(issue(project, "dirty-project", "warning", "Dirty project", `${project.branch?.dirtyFiles ?? 0} changed file(s)`, "project", project.path));
    }

    for (const worktree of project.worktrees) {
      if (!worktree.clean) {
        issues.push(issue(project, "dirty-worktree", "warning", "Dirty worktree", `${worktree.dirtyFiles ?? 0} changed file(s)`, "worktree", worktree.path));
      }
      if (worktree.removal?.canDelete) {
        issues.push(issue(project, "cleanup-candidate", "info", "Cleanup candidate", worktree.removal.reasons.join(" "), "worktree", worktree.path));
      }
    }

    for (const branch of project.branches) {
      if (branch.removal.canDelete) {
        issues.push(issue(project, "cleanup-candidate", "info", "Branch can be deleted", branch.removal.reasons.join(" "), "branch", branch.name));
      }
    }

    for (const service of project.services) {
      if (service.status === "port-occupied") {
        issues.push(issue(project, "occupied-port", "critical", "Port occupied", service.portsStatus.map((port) => `${port.port}:${port.pid ?? "unknown"}`).join(", "), "service", service.name));
      } else if (service.status === "stopped") {
        issues.push(issue(project, "stopped-service", "warning", "Stopped service", service.command, "service", service.name));
      }
    }
  }

  return {
    counts: {
      critical: issues.filter((candidate) => candidate.severity === "critical").length,
      warning: issues.filter((candidate) => candidate.severity === "warning").length,
      info: issues.filter((candidate) => candidate.severity === "info").length,
      dirtyProjects: projects.filter((project) => project.status === "dirty").length,
      dirtyWorktrees: projects.reduce((sum, project) => sum + project.worktrees.filter((worktree) => !worktree.clean).length, 0),
      cleanupCandidates: issues.filter((candidate) => candidate.kind === "cleanup-candidate").length,
      stoppedServices: issues.filter((candidate) => candidate.kind === "stopped-service").length,
      occupiedPorts: issues.filter((candidate) => candidate.kind === "occupied-port").length,
      missingProjects: projects.filter((project) => project.status === "missing").length
    },
    issues
  };
}

function issue(
  project: ProjectSnapshot,
  kind: HealthIssue["kind"],
  severity: HealthIssue["severity"],
  title: string,
  detail: string,
  targetType: NonNullable<HealthIssue["targetType"]>,
  target: string
): HealthIssue {
  return {
    id: `${project.id}:${kind}:${target}`,
    kind,
    severity,
    title,
    detail,
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    targetType,
    target,
    actionLabel: actionLabel(kind)
  };
}

function actionLabel(kind: HealthIssue["kind"]) {
  if (kind === "cleanup-candidate") return "Review cleanup";
  if (kind === "stopped-service") return "Open services";
  if (kind === "dirty-worktree" || kind === "dirty-project") return "Review changes";
  return "Inspect";
}
```

- [ ] **Step 5: Run health tests**

Run:

```powershell
npm test -- tests/health.test.ts
```

Expected: PASS.

### Task 2: Wire Health Into Dashboard API

**Files:**
- Modify: `src/server/app.ts`
- Test: `tests/api.test.ts`

- [ ] **Step 1: Add failing API assertion**

In `tests/api.test.ts`, extend the dashboard test to expect `body.health`.

```ts
expect(dashboardResponse.body.health).toMatchObject({
  counts: expect.objectContaining({
    missingProjects: 1
  }),
  issues: [
    expect.objectContaining({
      kind: "missing-project",
      projectName: "Missing repo"
    })
  ]
});
```

- [ ] **Step 2: Run the API test**

Run:

```powershell
npm test -- tests/api.test.ts
```

Expected: FAIL because dashboard responses do not include `health`.

- [ ] **Step 3: Wire `buildHealthSummary`**

In `src/server/app.ts`:

```ts
import { buildHealthSummary } from "./health";
```

Update `buildDashboardResponse`:

```ts
function buildDashboardResponse(projects: ProjectSnapshot[]): DashboardResponse {
  const sortedProjects = projects.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
  return {
    projects: sortedProjects,
    summary: { ...existingSummary },
    health: buildHealthSummary(sortedProjects)
  };
}
```

- [ ] **Step 4: Run API tests**

Run:

```powershell
npm test -- tests/api.test.ts tests/health.test.ts
```

Expected: PASS.

### Task 3: Health UI View

**Files:**
- Create: `src/lib/health-ui.ts`
- Test: `tests/health-ui.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write health UI helper tests**

Create `tests/health-ui.test.ts`.

```ts
import { describe, expect, it } from "vitest";

import { healthIssueTone, healthIssueLabel } from "../src/lib/health-ui";

describe("health-ui", () => {
  it("labels severities for compact cards", () => {
    expect(healthIssueTone("critical")).toBe("error");
    expect(healthIssueTone("warning")).toBe("dirty");
    expect(healthIssueTone("info")).toBe("neutral");
    expect(healthIssueLabel("stopped-service")).toBe("Service stopped");
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/health-ui.test.ts
```

Expected: FAIL because helper file does not exist.

- [ ] **Step 3: Implement helper**

Create `src/lib/health-ui.ts`.

```ts
import type { HealthIssueKind, HealthIssueSeverity } from "../shared/types";

export function healthIssueTone(severity: HealthIssueSeverity): "neutral" | "clean" | "dirty" | "error" {
  if (severity === "critical") return "error";
  if (severity === "warning") return "dirty";
  return "neutral";
}

export function healthIssueLabel(kind: HealthIssueKind): string {
  const labels: Record<HealthIssueKind, string> = {
    "cleanup-candidate": "Cleanup available",
    "dirty-project": "Project dirty",
    "dirty-worktree": "Worktree dirty",
    "missing-project": "Project missing",
    "occupied-port": "Port occupied",
    "stopped-service": "Service stopped"
  };
  return labels[kind];
}
```

- [ ] **Step 4: Add Health sidebar and panel**

In `src/App.tsx`:

- Add `"health"` to `SidebarView`.
- Add a sidebar button above `All Projects`.
- Add `HealthPanel`.
- Default view can remain `"projects"` for low disruption.

Panel behavior:

- Top cards:
  - Critical
  - Warnings
  - Cleanup
  - Stopped Services
- Issue list:
  - issue title
  - project name
  - target path/name
  - severity badge
  - action button that selects the project and switches inspector tab:
    - cleanup/dirty worktree -> `trees`
    - stopped service/occupied port -> `services`
    - dirty project/missing project -> `trees`

Minimal component shape:

```tsx
function HealthPanel({
  dashboard,
  onInspectIssue
}: {
  dashboard: DashboardResponse;
  onInspectIssue: (issue: HealthIssue) => void;
}) {
  if (dashboard.health.issues.length === 0) {
    return <div className="empty-state">All registered projects look healthy.</div>;
  }

  return (
    <section className="health-panel">
      <section className="stats">
        <Metric label="Critical" value={dashboard.health.counts.critical} />
        <Metric label="Warnings" value={dashboard.health.counts.warning} />
        <Metric label="Cleanup" value={dashboard.health.counts.cleanupCandidates} />
        <Metric label="Stopped" value={dashboard.health.counts.stoppedServices} />
      </section>
      <div className="health-list">
        {dashboard.health.issues.map((issue) => (
          <article className="health-row" key={issue.id}>
            <div>
              <strong>{issue.title}</strong>
              <span>{issue.projectName}</span>
              <span className="mono">{issue.target ?? issue.projectPath}</span>
            </div>
            <Badge tone={healthIssueTone(issue.severity)}>{healthIssueLabel(issue.kind)}</Badge>
            <Button onClick={() => onInspectIssue(issue)}>{issue.actionLabel ?? "Inspect"}</Button>
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add health styles**

In `src/styles.css`, add:

```css
.health-panel {
  display: grid;
  gap: 12px;
}

.health-list {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-strong);
}

.health-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  min-height: 62px;
  border-bottom: 1px solid var(--border);
  padding: 10px 12px;
  gap: 12px;
}

.health-row:last-child {
  border-bottom: 0;
}

.health-row > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}
```

- [ ] **Step 6: Run tests and build**

Run:

```powershell
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 7: Manual browser verification**

Open `http://127.0.0.1:5273/`.

Verify:

- Health appears in sidebar.
- Health view renders cards and issues.
- Clicking an issue selects the related project.
- No text overlaps at the current inspector width.

- [ ] **Step 8: Commit milestone 1**

Run:

```powershell
git add src tests README.md
git commit -m "Add project health overview"
```

---

## Milestone 2: Worktree And Branch Detail

### Task 4: Bounded Worktree Diff API

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/git.ts`
- Modify: `src/server/app.ts`
- Modify: `src/lib/api.ts`
- Test: `tests/git.test.ts`
- Test: `tests/api.test.ts`

- [ ] **Step 1: Add failing Git helper tests**

In `tests/git.test.ts`, add parser/argument tests before shelling out to real Git.

```ts
import { buildWorktreeDiffArgs } from "../src/server/git";

it("builds bounded file diff args", () => {
  expect(buildWorktreeDiffArgs("src/App.tsx", 160)).toEqual([
    "diff",
    "--",
    "src/App.tsx"
  ]);
});
```

If the helper does not need line limit in args, keep line limiting in TypeScript after reading stdout.

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/git.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Add shared types**

In `src/shared/types.ts`:

```ts
export type WorktreeDiffResponse = {
  worktreePath: string;
  filePath: string;
  diff: string;
  truncated: boolean;
  lineCount: number;
};
```

- [ ] **Step 4: Implement Git diff helper**

In `src/server/git.ts`:

```ts
export function buildWorktreeDiffArgs(filePath: string): string[] {
  return ["diff", "--", filePath];
}

export async function readWorktreeFileDiff(worktreePath: string, filePath: string, maxLines = 200): Promise<{
  diff: string;
  truncated: boolean;
  lineCount: number;
}> {
  const { stdout } = await git(worktreePath, buildWorktreeDiffArgs(filePath));
  const lines = stdout.split(/\r?\n/);
  const truncated = lines.length > maxLines;
  const kept = truncated ? lines.slice(0, maxLines) : lines;
  return {
    diff: kept.join("\n"),
    truncated,
    lineCount: lines.length
  };
}
```

- [ ] **Step 5: Add API endpoint**

In `src/server/app.ts`, add:

```ts
app.get("/api/projects/:id/worktrees/diff", async (request, response, next) => {
  try {
    const project = await findProject(registry, request.params.id);
    const worktreePath = String(request.query.path ?? "").trim();
    const filePath = String(request.query.file ?? "").trim();
    if (!worktreePath || !filePath) {
      response.status(400).json({ error: "Worktree path and file path are required." });
      return;
    }

    const snapshot = await snapshotProject(project, serviceManager);
    const worktree = snapshot.worktrees.find((candidate) => samePath(candidate.path, worktreePath));
    if (!worktree) {
      response.status(404).json({ error: "Worktree not found." });
      return;
    }
    if (!(worktree.changes ?? []).some((change) => change.path === filePath)) {
      response.status(404).json({ error: "Changed file not found in worktree." });
      return;
    }

    const diff = await readWorktreeFileDiff(worktree.path, filePath, 200);
    response.json({
      worktreePath: worktree.path,
      filePath,
      ...diff
    });
  } catch (error) {
    next(error);
  }
});
```

Security note: only allow file paths already present in `worktree.changes`.

- [ ] **Step 6: Add client API**

In `src/lib/api.ts`:

```ts
export async function getWorktreeDiff(projectId: string, worktreePath: string, filePath: string): Promise<WorktreeDiffResponse> {
  const params = new URLSearchParams({ path: worktreePath, file: filePath });
  return request<WorktreeDiffResponse>(`/api/projects/${projectId}/worktrees/diff?${params.toString()}`);
}
```

- [ ] **Step 7: Add API tests**

Use a temp Git repo in `tests/api.test.ts`, or keep this API test mocked only if test setup becomes too slow.

Expected assertions:

- missing query -> 400
- unknown worktree -> 404
- changed file returns bounded diff

- [ ] **Step 8: Run tests**

Run:

```powershell
npm test -- tests/git.test.ts tests/api.test.ts
```

Expected: PASS.

### Task 5: Worktree Diff Preview UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Optional Create: `src/lib/diff-ui.ts`
- Optional Test: `tests/diff-ui.test.ts`

- [ ] **Step 1: Add a small diff UI helper test if formatting is extracted**

Only create `src/lib/diff-ui.ts` if diff line styling starts cluttering `App.tsx`.

Example test:

```ts
expect(diffLineTone("+added")).toBe("added");
expect(diffLineTone("-removed")).toBe("removed");
expect(diffLineTone("@@ hunk")).toBe("hunk");
```

- [ ] **Step 2: Add diff state to `WorktreeChanges`**

In `src/App.tsx`, pass `project.id` into `WorktreeChanges`.

State:

```ts
const [selectedFile, setSelectedFile] = useState<string | null>(null);
const [diff, setDiff] = useState<WorktreeDiffResponse | null>(null);
const [diffLoading, setDiffLoading] = useState(false);
const [diffError, setDiffError] = useState<string | null>(null);
```

When a change row is clicked:

```ts
async function loadDiff(filePath: string) {
  setSelectedFile(filePath);
  setDiffLoading(true);
  setDiffError(null);
  try {
    setDiff(await getWorktreeDiff(projectId, worktree.path, filePath));
  } catch (caught) {
    setDiffError((caught as Error).message);
  } finally {
    setDiffLoading(false);
  }
}
```

- [ ] **Step 3: Render diff preview**

Add a panel under the change list or as a second column when space allows.

Minimum UI:

- selected file name
- `Copy path` button
- diff code block
- truncated badge if `diff.truncated`
- empty state for binary/empty diff

- [ ] **Step 4: Add styles**

In `src/styles.css`:

```css
.diff-preview {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(29, 29, 31, 0.94);
}

.diff-preview pre {
  overflow: auto;
  max-height: 320px;
  margin: 0;
  padding: 10px;
  color: #f5f5f7;
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.5;
}
```

- [ ] **Step 5: Browser verification**

Open a project with changed files.

Verify:

- clicking a file loads diff
- long diff scrolls inside panel
- path copy works
- no layout shift in narrow inspector width

### Task 6: Branch Detail Enrichment

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/git.ts`
- Modify: `src/server/app.ts`
- Modify: `src/App.tsx`
- Test: `tests/git.test.ts`
- Test: `tests/api.test.ts` if API shape changes

- [ ] **Step 1: Decide branch details to ship first**

YAGNI choice for first pass:

- current/merged/unmerged
- used by worktree
- deletion safety
- upstream if available
- ahead/behind if upstream available

Do not add full branch commit history yet.

- [ ] **Step 2: Add type fields**

In `src/shared/types.ts`, extend `BranchInfo`:

```ts
upstream?: string | null;
ahead?: number;
behind?: number;
```

- [ ] **Step 3: Add Git helper**

In `src/server/git.ts`, add a parser for:

```powershell
git for-each-ref --format="%(refname:short)|%(upstream:short)|%(upstream:track)" refs/heads
```

Parse `%(upstream:track)` values like:

- `[ahead 2]`
- `[behind 3]`
- `[ahead 2, behind 3]`
- empty

Test parser in `tests/git.test.ts`.

- [ ] **Step 4: Wire branch details in `snapshotProject`**

In `src/server/app.ts`, read branch tracking data in the existing parallel block and pass fields into `buildBranchInfo`, or merge them after `buildBranchInfo`.

- [ ] **Step 5: Render details in `BranchPanel`**

In `src/App.tsx`, update each branch row:

- line 1: branch name
- line 2: `merged · in worktree`
- line 3: upstream/ahead/behind if available
- right side: safety badge and delete button

Keep the row dense. Avoid cards inside cards.

- [ ] **Step 6: Run tests and build**

Run:

```powershell
npm test
npm run build
```

- [ ] **Step 7: Commit milestone 2**

Run:

```powershell
git add src tests
git commit -m "Add worktree and branch detail views"
```

---

## Milestone 3: Service Groups

### Task 7: Service Group Registry Model

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/registry.ts`
- Test: `tests/registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

In `tests/registry.test.ts`, add:

```ts
it("stores and normalizes service groups", async () => {
  const registry = new ProjectRegistry(join(tempDir, "projects.json"));
  const project = await registry.addProject({ name: "Demo", path: "E:/demo" });
  const api = await registry.addService(project.id, {
    name: "API",
    cwd: "E:/demo",
    command: "npm run api"
  });
  const web = await registry.addService(project.id, {
    name: "Web",
    cwd: "E:/demo",
    command: "npm run web"
  });

  const group = await registry.addServiceGroup(project.id, {
    name: "Dev stack",
    serviceIds: [api.id, web.id]
  });

  expect(group).toMatchObject({ name: "Dev stack", serviceIds: [api.id, web.id] });
  expect((await registry.listProjects())[0].serviceGroups).toHaveLength(1);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/registry.test.ts
```

Expected: FAIL because service groups do not exist.

- [ ] **Step 3: Add shared types**

In `src/shared/types.ts`:

```ts
export type RegisteredServiceGroup = {
  id: string;
  name: string;
  serviceIds: string[];
  createdAt: string;
  updatedAt: string;
};
```

Add `serviceGroups: RegisteredServiceGroup[]` to `RegisteredProject`.

Add snapshot type if group status is computed:

```ts
export type ServiceGroupSnapshot = RegisteredServiceGroup & {
  services: ServiceSnapshot[];
  status: "running" | "partial" | "stopped" | "error";
};
```

- [ ] **Step 4: Implement registry methods**

In `src/server/registry.ts`:

- `addServiceGroup(projectId, input)`
- `updateServiceGroup(projectId, groupId, input)`
- `removeServiceGroup(projectId, groupId)`
- normalize missing `serviceGroups` to `[]`
- when removing a service, also remove that service id from every group

- [ ] **Step 5: Run registry tests**

Run:

```powershell
npm test -- tests/registry.test.ts
```

Expected: PASS.

### Task 8: Service Group API And Orchestration

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/lib/api.ts`
- Test: `tests/api.test.ts`

- [ ] **Step 1: Add failing API tests**

Test:

- create group
- delete group
- group appears in project snapshot
- start group starts services in configured order
- stop group stops services in reverse order

Use fake `serviceManager` for deterministic assertions.

- [ ] **Step 2: Add API endpoints**

In `src/server/app.ts`:

```ts
app.post("/api/projects/:id/service-groups", ...)
app.patch("/api/projects/:id/service-groups/:groupId", ...)
app.delete("/api/projects/:id/service-groups/:groupId", ...)
app.post("/api/projects/:id/service-groups/:groupId/start", ...)
app.post("/api/projects/:id/service-groups/:groupId/stop", ...)
app.post("/api/projects/:id/service-groups/:groupId/restart", ...)
```

Rules:

- Start services in group order.
- Stop services in reverse group order.
- Continue collecting per-service results if one service fails, but return status `207` or `202` with errors included. Prefer `202` with a result object for simpler client handling.
- Record activity:
  - `service-group.add`
  - `service-group.remove`
  - `service-group.start`
  - `service-group.stop`
  - `service-group.restart`

- [ ] **Step 3: Add API client methods**

In `src/lib/api.ts`:

```ts
export async function addServiceGroup(projectId: string, payload: AddServiceGroupPayload): Promise<RegisteredServiceGroup> { ... }
export async function removeServiceGroup(projectId: string, groupId: string): Promise<void> { ... }
export async function startServiceGroup(projectId: string, groupId: string): Promise<ServiceGroupActionResponse> { ... }
export async function stopServiceGroup(projectId: string, groupId: string): Promise<ServiceGroupActionResponse> { ... }
export async function restartServiceGroup(projectId: string, groupId: string): Promise<ServiceGroupActionResponse> { ... }
```

- [ ] **Step 4: Run API tests**

Run:

```powershell
npm test -- tests/api.test.ts
```

Expected: PASS.

### Task 9: Service Group UI

**Files:**
- Create: `src/lib/service-groups-ui.ts`
- Test: `tests/service-groups-ui.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add UI helper tests**

```ts
import { describe, expect, it } from "vitest";

import { serviceGroupStatusLabel, serviceGroupStatusTone } from "../src/lib/service-groups-ui";

describe("service-groups-ui", () => {
  it("labels group status", () => {
    expect(serviceGroupStatusLabel("running")).toBe("Running");
    expect(serviceGroupStatusLabel("partial")).toBe("Partial");
    expect(serviceGroupStatusTone("partial")).toBe("dirty");
  });
});
```

- [ ] **Step 2: Implement helper**

Create `src/lib/service-groups-ui.ts`.

- [ ] **Step 3: Add Add Service Group dialog**

In `src/App.tsx`:

- dialog fields:
  - group name
  - checklist of existing services
- validation:
  - name required
  - at least one service required
- submit calls `addServiceGroup`

- [ ] **Step 4: Update ServicePanel**

In `ServicePanel`:

- Add a `Groups` section above individual services.
- Each group row shows:
  - name
  - status badge
  - service count
  - member service names
  - Start Group / Stop Group / Restart Group
  - delete group button
- Keep individual services visible below.

- [ ] **Step 5: Add styles**

In `src/styles.css`:

```css
.service-group-list {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.service-group-card {
  display: grid;
  gap: 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.78);
  padding: 10px;
}

.service-group-members {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
```

- [ ] **Step 6: Browser verification**

Open a project with multiple services.

Verify:

- can create a service group
- group appears above services
- start/stop/restart buttons call APIs
- activity log records group actions
- deleting a group prompts confirmation
- removing a service updates group membership safely

- [ ] **Step 7: Run full validation**

Run:

```powershell
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 8: Update README**

Add:

- Health overview description
- Diff preview behavior and bounded diff note
- Service group runtime behavior
- Reminder that `data/` is local-only and ignored

- [ ] **Step 9: Commit milestone 3**

Run:

```powershell
git add README.md src tests
git commit -m "Add service groups"
```

---

## Final Integration

- [ ] **Step 1: Run all validation**

Run:

```powershell
npm test
npm run build
git diff --check
```

Expected:

- all tests pass
- build passes
- no whitespace errors

- [ ] **Step 2: Browser QA**

Open:

```text
http://127.0.0.1:5273/
```

Check:

- Health view works at default window width.
- Worktree diff panel does not overflow.
- Branch detail rows stay aligned.
- Service groups fit inside the inspector.
- Tooltip positioning still stays inside the inspector.
- Activity log records all destructive and service group actions.

- [ ] **Step 3: Final commit if needed**

If QA required fixes:

```powershell
git add README.md src tests
git commit -m "Polish roadmap features"
```

- [ ] **Step 4: Push**

Run:

```powershell
git push origin main
```

---

## Execution Notes

- Keep `data/` ignored. Do not commit local registry or activity logs.
- Prefer small pure helper modules and tests over adding more logic directly into `App.tsx`.
- Keep destructive actions behind the existing confirmation dialog.
- Keep API diff responses bounded. Never return unbounded file diffs.
- Use existing button, badge, dialog, input, and segmented-control components.
- Do not add a new UI framework; stay with the current local shadcn-style component pattern.
