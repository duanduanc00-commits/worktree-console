# Architecture

Worktree Console is a local-first React and Express app. The browser UI talks to a local API server, and the API reads only projects registered by the user.

## Runtime Shape

```text
Browser UI
  |
  | /api through Vite proxy
  v
Express API
  |
  +-- Git readers for registered repositories
  +-- Registry JSON for projects, services, and service groups
  +-- Activity JSON for local operation history
  +-- Service manager for local process and port checks
```

The app does not scan the full machine. It builds dashboard state from registered project paths and their Git-linked worktrees.

## Main Modules

- `src/App.tsx` owns the current React shell, view state, inspector behavior, dialogs, and user actions.
- `src/lib/api.ts` contains client calls to the local API.
- `src/lib/*-ui.ts` contains small, tested UI helper functions.
- `src/lib/refresh-ui.ts` contains the automatic refresh policy.
- `src/server/app.ts` owns API routes and orchestration.
- `src/server/git.ts` owns Git command execution and parsing.
- `src/server/registry.ts` owns project, service, and service-group persistence.
- `src/server/services.ts` owns process spawning, stop/restart behavior, health checks, and port detection.
- `src/server/health.ts` derives actionable health issues from project snapshots.
- `src/server/activity.ts` records local operations.
- `src/shared/types.ts` defines shared API and registry types.

## Data Flow

1. A project is registered through the UI or API.
2. The registry writes project metadata to local JSON.
3. Dashboard refresh reads every registered project path.
4. Git state, worktrees, branches, commits, service state, and health issues are returned as one dashboard snapshot.
5. UI actions that change state call the API, then refresh the dashboard and activity log as needed.

The browser also refreshes the open console automatically every 30 seconds while the tab is visible. Hidden tabs skip automatic refresh to avoid unnecessary local Git and service checks.

## Local Data

By default, local runtime data is stored under `data/`:

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

## Service Safety

Services are registered per project with a working directory, command, optional ports, and optional health URL.

The console distinguishes between:

- Console-managed processes started by Worktree Console.
- External processes detected through ports or health checks.

Stop and restart controls are available for console-managed processes. External processes are detected and shown, but the console does not stop them.

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
