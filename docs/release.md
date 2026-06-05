# Release Model

Worktree Console supports a source-run development workflow and an npm/npx package workflow. Both run locally on the user's machine.

## Current Channel

- Source repository: `https://github.com/duanduanc00-commits/worktree-console`
- License: MIT
- Development runtime: local Vite frontend plus local Express API
- Packaged runtime: one local Express server that serves both `/api` and the built frontend
- Package status: npm-ready package metadata with a `worktree-console` bin entry

The package is not published until a maintainer runs the npm publish flow. If the unscoped `worktree-console` package name is unavailable, publish under a scope and update the README command.

## Supported Setup

Requirements:

- Node.js 22 or newer
- npm, which is included with Node.js
- Git installed and available from the shell
- Local port `5273` available for packaged runs
- Local ports `5273` and `4217` available for the default source development URLs

Published package run:

```powershell
npx worktree-console
```

Local package-runtime smoke test from a clone:

```powershell
npm ci
npm run build
npm start -- --no-open
```

Source development run:

```powershell
npm ci
npm run dev
```

Default source development URLs when the default ports are available:

- Frontend: `http://127.0.0.1:5273`
- API: `http://127.0.0.1:4217`

If port `5273` is already in use, Vite may print a different frontend URL in the terminal. If port `4217` is already in use, set `PORT` for the API and update the `/api` proxy target in `vite.config.ts` to the same port.

Packaged runs use one port. Override it with:

```powershell
npx worktree-console --port 6600
```

Packaged runs store registry and activity data in the platform user-data directory by default. Override that with `--data-dir` or `WORKTREE_CONSOLE_DATA_DIR` when testing.

Build and test before sharing a change:

```powershell
npm test
npm run build
```

## Release Checklist

Before tagging a source release:

- Run `npm ci`, `npm test`, and `npm run build` from a clean checkout.
- Run `npm pack --dry-run` and inspect that `bin/`, `dist/`, `src/server/`, `src/shared/`, `src/cli.ts`, `README.md`, and `LICENSE` are included.
- Run `npm publish --dry-run` before the first real publish.
- Smoke test `node bin/worktree-console.js --port <free-port> --data-dir <temp-dir> --no-open`, then verify `/` and `/api/health` on that port.
- Review `README.md`, `SECURITY.md`, and `docs/architecture.md` for behavior drift.
- Check that no local `data/`, service commands, logs, or machine-specific paths are committed.
- Confirm destructive actions still require safety assessment and confirmation.
- Create a GitHub release that links to the tag and summarizes user-facing changes.

## Future Packaging Options

Likely future channels:

- npm package releases through the `worktree-console` bin.
- Documented source-run releases with tagged versions.
- A local desktop shell that bundles the API and frontend.
- Platform-specific installers once service control and data-directory behavior are stable.

Until the first npm publish is completed, the source-run workflow and local `node bin/worktree-console.js` smoke path are the supported paths.
