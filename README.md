# Worktree Console

A local-first console for tracking registered Git projects, their worktrees, branches, commits, and project services.

## Features

- Register only the local projects you want to track.
- Review a Health view that groups missing projects, dirty worktrees, cleanup candidates, stopped services, and occupied ports.
- Inspect Git branch, upstream, gone-upstream, ahead/behind, worktree, change, commit, and safe-removal status.
- Open a bounded diff preview for changed worktree files without leaving the console.
- Register project services and tasks with local commands, ports, health URLs, and log previews.
- Start, stop, restart, and open services from the console, with safer handling for externally started processes.
- Group related services, then start, stop, restart, or remove the group while preserving individual service registrations.

## Development

```powershell
npm install
npm run dev
```

The frontend runs on Vite and the API listens on `127.0.0.1:4217` by default.

## Services

Services are registered per project with a working directory, command, optional ports, and optional health URL. Services with ports behave like long-running local apps. Services without ports are shown as tasks and can be run once without showing unavailable stop/restart controls.

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
