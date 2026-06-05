# AGENTS.md

Guidance for AI agents working in this repository.

## Project Summary

Worktree Console is a local-first React + Express app for managing registered Git projects. It tracks worktrees, branches, bounded diffs, recent commits, local services, service groups, project health, cleanup safety, and activity history.

The product intentionally records only user-registered local projects. Do not add automatic whole-disk scanning.

## Runtime

Packaged one-command runtime:

```powershell
npx worktree-console
```

Packaged runtime defaults:

- Console and API: `http://127.0.0.1:5273`
- API namespace: `http://127.0.0.1:5273/api`
- User data directory: platform user-data location unless overridden by `--data-dir` or environment variables

The npm package is ready to publish but may not yet exist on npm. From a clone, smoke test the packaged runtime with:

```powershell
npm install
npm run build
npm start -- --no-open
```

Default source development commands:

```powershell
npm install
npm run dev
```

Default source development ports:

- Frontend: `http://127.0.0.1:5273`
- API: `http://127.0.0.1:4217`

The source development URLs assume ports `5273` and `4217` are available. The API port is controlled by `PORT`. If the API port changes, update the Vite `/api` proxy target in `vite.config.ts` to the same port. Packaged runtime uses one port and supports `--port`.

## Local Data

Packaged runtime data is local-only and stored outside the repository by default:

- Windows: `%LOCALAPPDATA%\Worktree Console`
- macOS: `~/Library/Application Support/Worktree Console`
- Linux: `$XDG_DATA_HOME/worktree-console` or `~/.local/share/worktree-console`

Source development data is local-only and ignored by Git:

- `data/projects.json`
- `data/activity-log.json`

The default paths can be overridden with:

```powershell
$env:WORKTREE_CONSOLE_REGISTRY="C:\Users\you\AppData\Local\Worktree Console\projects.json"
$env:WORKTREE_CONSOLE_ACTIVITY_LOG="C:\Users\you\AppData\Local\Worktree Console\activity-log.json"
```

Never commit `data/`, `work/`, `outputs/`, generated logs, or machine-specific registry files.

## Open Source Files

Keep these files present and aligned with behavior:

- `LICENSE` uses MIT.
- `CONTRIBUTING.md` describes local setup, validation, and contribution boundaries.
- `SECURITY.md` describes private vulnerability reporting and local data privacy.
- `CODE_OF_CONDUCT.md` describes project collaboration expectations.
- `.github/workflows/ci.yml` runs `npm ci`, `npm test`, and `npm run build`.
- `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE.md` guide public collaboration.
- `docs/release.md` describes the current release model and release checklist.
- `docs/architecture.md` describes the local-first architecture, module ownership, and safety boundaries.

When changing local data behavior, destructive actions, service controls, Git cleanup safety, release behavior, or architecture, update `README.md`, `SECURITY.md`, `docs/architecture.md`, `docs/release.md`, and this file as needed.

## Architecture Notes

- `src/server/app.ts` owns API routing and orchestration.
- `src/server/runtime.ts` owns packaged runtime config, user data paths, CLI flags, static frontend serving, and browser opening.
- `src/server/git.ts` owns Git command helpers and parsers.
- `src/server/gitOperations.ts` owns route-safe Git operation validation, status building, and safety checks.
- `src/server/registry.ts` owns persistent project, service, and service-group registration.
- `src/server/services.ts` owns local process, process-tree ownership, and port detection.
- `src/server/health.ts` derives health issues from project snapshots only; keep it pure.
- `src/server/activity.ts` records local console operations.
- `src/lib/*-ui.ts` files contain small UI helper functions with direct tests.
- `src/App.tsx` is currently the main UI shell; prefer extracting small helpers before adding large new flows directly into it.
- `docs/architecture.md` should reflect new module boundaries and important data flows.

## Product Boundaries

- Keep the app local-first. Avoid adding remote telemetry, hosted storage, or background scanning unless explicitly requested.
- Keep destructive Git cleanup conservative. Worktree and branch deletion must stay behind safety assessment and confirmation.
- Git operation routes must re-read registered project snapshots before running commands.
- Do not add force push, merge, rebase, checkout, stash apply/drop, or remote setup without a separate design.
- Detached worktrees should not be marked safe when their HEAD is not contained by any reported branch.
- Do not stop unknown external processes that were only detected by port. Service controls may stop console-started processes, and may stop external processes only when the backend matches the listening PID's process tree to the registered project path or service working directory.
- Keep diff APIs bounded and only allow diffs for changed files reported by the corresponding worktree snapshot.
- Health summary cards are interactive filters. Keep their labels and tooltip text short.
- Activity log should record meaningful user actions, especially destructive actions and service operations.
- The browser dashboard refreshes automatically every 30 seconds while the tab is visible. Keep auto-refresh policy in `src/lib/refresh-ui.ts` so it stays directly testable.
- UI layouts for Git operations must keep `min-width: 0` containment and avoid horizontal overflow.

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

For release or package-runtime changes, also run:

```powershell
node bin/worktree-console.js --help
npm pack --dry-run
```

For UI changes, also verify the running app in a browser at `http://127.0.0.1:5273/`.

## Git Hygiene

The main branch is used for the local project. Keep commits focused. If a local commit has not been pushed and the user asks to include docs with the current change, prefer amending that local commit instead of creating a separate documentation-only commit.
