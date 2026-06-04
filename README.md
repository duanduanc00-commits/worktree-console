# Worktree Console

[![CI](https://github.com/duanduanc00-commits/worktree-console/actions/workflows/ci.yml/badge.svg)](https://github.com/duanduanc00-commits/worktree-console/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Worktree Console is a local-first dashboard for registered Git projects. It helps you see which projects, worktrees, branches, and local services need attention without scanning every repository by hand.

The app only tracks projects you register. Runtime data stays local and is ignored by Git.

## Features

- Register only the local projects you want to track.
- Review a Health view for missing projects, dirty checkouts, safe cleanup candidates, stopped services, and occupied ports.
- Click Health summary cards to filter the issue list; hover or focus them for a short explanation of each count.
- Inspect worktrees, local branches, upstream/gone-upstream state, ahead/behind counts, recent commits, and safe-removal status.
- Associate branch rows with their owning worktree and open related changes when local modifications exist.
- Open a bounded diff preview for changed worktree files without leaving the console.
- Choose recent commit count or time range for the main registered project checkout.
- Register project services and one-shot tasks with local commands, ports, health URLs, and log previews.
- Start, stop, restart, and open services from the console, with safer handling for externally started processes.
- Group related services into a stack, then start, stop, restart, or remove the group while preserving individual service registrations.
- Review the Activity view for operations such as project changes, service actions, branch deletion, and worktree removal.

## Quick Start

```powershell
npm install
npm run dev
```

By default:

- Frontend: `http://127.0.0.1:5273`
- API: `http://127.0.0.1:4217`

The Vite dev server proxies `/api` to the local API server.

## Development Commands

```powershell
npm ci
npm test
npm run build
```

`npm test` runs the Vitest suite. `npm run build` runs TypeScript checking and a production Vite build.

## Open Source And Safety

Worktree Console is open source under the MIT License. See [LICENSE](LICENSE).

Before contributing, read:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

Security and privacy boundaries:

- The app tracks only projects you register.
- The app does not scan the whole machine automatically.
- The app does not upload registry or activity data.
- Local runtime data can include private paths, commands, ports, and operation history.
- Destructive Git actions must stay behind safety checks and confirmation.
- Service controls do not stop external processes that were only detected by port.

Pull requests are checked by GitHub Actions with `npm ci`, `npm test`, and `npm run build`.

## Git And Cleanup Safety

Worktree Console reads Git state from the registered project path and its linked worktrees. Destructive cleanup actions are intentionally conservative:

- Worktrees and branches are marked as safe, review, or blocked before deletion controls appear.
- Deletion actions require confirmation.
- Dirty worktrees and the registered project checkout are blocked from one-click removal.
- Branches currently used by a worktree are marked in use.

Diff previews are bounded so the API does not return unbounded file diffs.

## Services

Services are registered per project with a working directory, command, optional ports, and optional health URL.

Services with ports behave like long-running local apps. Services without ports are shown as tasks and can be run once without showing unavailable stop/restart controls.

Service groups collect existing project services into a named stack. Starting a group starts services in the saved order. Stopping a group stops services in reverse order. Restarting a group follows the same stop-then-start ordering. Removing a group only removes the grouping metadata; the individual services remain registered.

The console distinguishes processes it started from external processes already listening on a configured port. It will not stop external processes from the service controls.

## Runtime Data

Local runtime data is written under `data/` by default:

- `data/projects.json` stores registered projects, services, and service groups.
- `data/activity-log.json` stores console operation history.

The entire `data/` directory is intentionally ignored because it contains machine-specific project paths, service commands, ports, and local operation history.

You can move these files outside the repository with environment variables:

```powershell
$env:WORKTREE_CONSOLE_REGISTRY="C:\Users\you\AppData\Local\Worktree Console\projects.json"
$env:WORKTREE_CONSOLE_ACTIVITY_LOG="C:\Users\you\AppData\Local\Worktree Console\activity-log.json"
```

You can also override the API port:

```powershell
$env:PORT="4217"
npm run dev:api
```

If you change the API port, update the Vite proxy in `vite.config.ts` or run the frontend behind an equivalent proxy.

## Project Layout

- `src/App.tsx` contains the main React shell and local console views.
- `src/components/ui/` contains the local shadcn-style primitives.
- `src/lib/` contains client API wrappers and UI helper functions.
- `src/server/` contains the Express API, Git readers, registry, service manager, activity log, and health summary builder.
- `src/shared/types.ts` contains shared API and registry types.
- `tests/` contains Vitest and supertest coverage for server behavior and UI helpers.
- `docs/superpowers/plans/` contains implementation plans used during agent-driven development.
