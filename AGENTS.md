# AGENTS.md

Guidance for AI agents working in this repository.

## Project Summary

Worktree Console is a local-first React + Express app for managing registered Git projects. It tracks worktrees, branches, bounded diffs, recent commits, local services, service groups, project health, cleanup safety, and activity history.

The product intentionally records only user-registered local projects. Do not add automatic whole-disk scanning.

## Runtime

Default development commands:

```powershell
npm install
npm run dev
```

Default ports:

- Frontend: `http://127.0.0.1:5273`
- API: `http://127.0.0.1:4217`

The API port is controlled by `PORT`. The Vite proxy target is defined in `vite.config.ts`.

## Local Data

Runtime data is local-only and ignored by Git:

- `data/projects.json`
- `data/activity-log.json`

The default paths can be overridden with:

```powershell
$env:WORKTREE_CONSOLE_REGISTRY="C:\Users\you\AppData\Local\Worktree Console\projects.json"
$env:WORKTREE_CONSOLE_ACTIVITY_LOG="C:\Users\you\AppData\Local\Worktree Console\activity-log.json"
```

Never commit `data/`, `work/`, `outputs/`, generated logs, or machine-specific registry files.

## Architecture Notes

- `src/server/app.ts` owns API routing and orchestration.
- `src/server/git.ts` owns Git command helpers and parsers.
- `src/server/registry.ts` owns persistent project, service, and service-group registration.
- `src/server/services.ts` owns local process and port detection.
- `src/server/health.ts` derives health issues from project snapshots only; keep it pure.
- `src/server/activity.ts` records local console operations.
- `src/lib/*-ui.ts` files contain small UI helper functions with direct tests.
- `src/App.tsx` is currently the main UI shell; prefer extracting small helpers before adding large new flows directly into it.

## Product Boundaries

- Keep the app local-first. Avoid adding remote telemetry, hosted storage, or background scanning unless explicitly requested.
- Keep destructive Git cleanup conservative. Worktree and branch deletion must stay behind safety assessment and confirmation.
- Do not stop external processes that were only detected by port. Service controls may stop processes started by this console.
- Keep diff APIs bounded and only allow diffs for changed files reported by the corresponding worktree snapshot.
- Health summary cards are interactive filters. Keep their labels and tooltip text short.
- Activity log should record meaningful user actions, especially destructive actions and service operations.

## UI Conventions

- Follow the existing macOS-like, shadcn-style local component pattern in `src/components/ui/`.
- Use lucide icons where practical.
- Keep operational screens dense and scannable. Avoid landing-page treatment.
- Avoid nested cards and avoid decorative gradient/orb backgrounds.
- Make hover/focus tooltips concise and ensure they stay within the visible panel.

## Verification

Before claiming a code or documentation change is ready, run:

```powershell
npm test
npm run build
git diff --check
```

For UI changes, also verify the running app in a browser at `http://127.0.0.1:5273/`.

## Git Hygiene

The main branch is used for the local project. Keep commits focused. If a local commit has not been pushed and the user asks to include docs with the current change, prefer amending that local commit instead of creating a separate documentation-only commit.
