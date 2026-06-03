# Worktree Console

A local-first console for tracking registered Git projects, their worktrees, branches, commits, and project services.

## Features

- Register only the local projects you want to track.
- Inspect Git branch, worktree, change, commit, and safe-removal status.
- Register project services and tasks with local commands, ports, health URLs, and log previews.
- Start, stop, restart, and open services from the console, with safer handling for externally started processes.

## Development

```powershell
npm install
npm run dev
```

The frontend runs on Vite and the API listens on `127.0.0.1:4217` by default.

## Runtime Data

Local registry data is written to `data/projects.json` by default. This file is intentionally ignored because it contains machine-specific project paths and service commands.
