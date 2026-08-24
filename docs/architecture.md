# Architecture

Worktree Console is a local-first React and Express app. The browser UI talks to a local API server, and the API reads only projects registered by the user.

## Runtime Shape

```text
Source development
  Browser UI on Vite 5273
    |
    | /api through Vite proxy
    v
  Express API on 4217

Packaged runtime
  Browser UI and /api from one Express server on 5273

Shared backend
  |
  +-- Git readers for registered repositories
  +-- Registry JSON for projects, services, and service groups
  +-- Activity JSON for local operation history
  +-- Service manager for local process and port checks
```

The app does not scan disks or discover repositories outside the registry. It builds dashboard state from registered project paths and their Git-linked worktrees. Service discovery enumerates local TCP listeners, but retains and returns only processes matched to those registered worktree paths.

## Main Modules

- `src/App.tsx` owns the current React shell, view state, inspector behavior, dialogs, and user actions.
- `src/lib/api.ts` contains client calls to the local API.
- `src/lib/*-ui.ts` contains small, tested UI helper functions.
- `src/lib/refresh-ui.ts` contains the automatic refresh policy.
- `src/server/app.ts` owns API routes and orchestration.
- `src/server/runtime.ts` owns packaged runtime configuration, CLI flags, user data paths, static frontend serving, and browser opening.
- `src/server/git.ts` owns Git command execution and parsing.
- `src/server/gitOperations.ts` owns route-safe Git operation target validation, status building, and safety checks.
- `src/server/registry.ts` owns project, service, and service-group persistence.
- `src/server/services.ts` owns process spawning, stop/restart behavior, health checks, port detection, and process-tree ownership checks.
- `src/server/health.ts` derives actionable health issues from project snapshots.
- `src/server/activity.ts` records local operations.
- `src/shared/types.ts` defines shared API and registry types.

## Data Flow

1. A project is registered through the UI or API.
2. The registry writes project metadata to local JSON.
3. Dashboard refresh reads every registered project path.
4. The service manager matches local listeners to the registered project's current Git worktree paths and discards unmatched process metadata.
5. Git state, worktrees, branches, commits, registered service state, read-only detected worktree services, and health issues are returned as one dashboard snapshot.
5. UI actions that change state call the API, then refresh the dashboard and activity log as needed.

The browser also refreshes the open console automatically every 30 seconds while the tab is visible. Hidden tabs skip automatic refresh to avoid unnecessary local Git and service checks.

## Local Data

Packaged `npx worktree-console` stores local runtime data outside the repository by default:

- Windows: `%LOCALAPPDATA%\Worktree Console`
- macOS: `~/Library/Application Support/Worktree Console`
- Linux: `$XDG_DATA_HOME/worktree-console` or `~/.local/share/worktree-console`

Source development runs store local runtime data under `data/` by default:

- `data/projects.json`
- `data/activity-log.json`

Both files are ignored by Git. They can include private paths, commands, ports, and operation history.

Use environment variables to move them outside the repository:

```powershell
$env:WORKTREE_CONSOLE_REGISTRY="C:\Users\you\AppData\Local\Worktree Console\projects.json"
$env:WORKTREE_CONSOLE_ACTIVITY_LOG="C:\Users\you\AppData\Local\Worktree Console\activity-log.json"
```

## Git Safety

Destructive Git actions follow a conservative flow:

- The API calculates a removal assessment before controls are enabled.
- Dirty project checkouts and dirty worktrees are blocked from one-click cleanup.
- Clean detached worktrees require review when their HEAD is not contained by any reported branch.
- Branches currently used by a worktree are blocked from deletion.
- Deletion actions require confirmation.
- Diff previews are bounded and tied to files reported by the matching worktree snapshot.

Daily Git operations live under project-scoped `/api/projects/:id/git/*` routes. `GET /api/projects/:id/git/status` resolves the selected registered project or worktree and builds the current Git operation status. Mutation routes are `fetch`, `pull`, `push`, `stage`, `unstage`, `commit`, and `stash`.

Before any mutation executes, the API re-reads the registered project snapshot and validates the selected target against that snapshot. After the Git command runs, the response returns refreshed Git operation status for the same target. Each attempt is recorded in Activity as `git.*` with `targetType: "git"`.

Operation scope is intentionally narrow: pull is blocked when local changes are present or the branch is diverged, push is ordinary `git push` only, and commit requires staged files plus a non-empty message.

## Service Safety

Services are registered per project with a working directory, command, optional ports, and optional health URL.

The console distinguishes between:

- Console-managed processes started by Worktree Console.
- Project external processes started outside the console whose listening PID process tree matches the registered project path, service working directory, or a linked worktree.
- Unknown external processes detected through ports or health checks without a project-path match.

Dashboard refresh also performs read-only discovery for unregistered TCP listeners. Listeners are grouped by PID and matched only when the listening process's own working directory is inside a current Git worktree; this stricter rule excludes IDEs, terminals, and language servers whose ancestor process merely references a worktree. A process is also excluded when any listening port is already covered by a registered service. Results are returned in `ProjectSnapshot.detectedServices`; they are never added to the registry and expose no start, stop, restart, log, or delete controls.

Stop and restart controls are available for console-managed processes. Stop is also available for registered project external processes after UI confirmation; the backend re-reads linked worktrees and re-inspects the registered service ports and process tree before terminating any PID. Unknown external processes and auto-detected unregistered services cannot be stopped. Restart stays console-managed only.

## Health

`src/server/health.ts` builds health issues from dashboard snapshots. The Health view groups those issues by project and lets users filter by summary card:

- Critical
- Warnings
- Cleanup
- Stopped

Health should stay actionable. Avoid adding passive trivia that does not lead to a concrete inspection or cleanup step.

## Frontend Layout

The UI uses a macOS-like operational console layout:

- Left sidebar for major views.
- Center project list or health/activity content.
- Right inspector for selected project details.

The inspector is resizable. When a changed worktree is opened, the inspector can temporarily expand to make file lists and diff previews easier to read.
