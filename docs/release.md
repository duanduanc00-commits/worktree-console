# Release Model

Worktree Console is currently distributed as a source-run beta. Users clone the repository, install dependencies, and run the local development server on their own machine.

## Current Channel

- Source repository: `https://github.com/duanduanc00-commits/worktree-console`
- License: MIT
- Runtime: local React frontend plus local Express API
- Package status: `private: true`

The package is private because the project is not yet published as an npm package or bundled desktop app. This avoids accidental package publication while the public repository remains usable from source.

## Supported Setup

Requirements:

- Node.js 22 or newer
- npm
- Git

Install and run:

```powershell
npm ci
npm run dev
```

Default local URLs:

- Frontend: `http://127.0.0.1:5273`
- API: `http://127.0.0.1:4217`

Build and test before sharing a change:

```powershell
npm test
npm run build
```

## Release Checklist

Before tagging a source release:

- Run `npm ci`, `npm test`, and `npm run build` from a clean checkout.
- Review `README.md`, `SECURITY.md`, and `docs/architecture.md` for behavior drift.
- Check that no local `data/`, service commands, logs, or machine-specific paths are committed.
- Confirm destructive actions still require safety assessment and confirmation.
- Create a GitHub release that links to the tag and summarizes user-facing changes.

## Future Packaging Options

Likely future channels:

- A documented source-run release with tagged versions.
- A local desktop shell that bundles the API and frontend.
- Platform-specific installers once service control and data-directory behavior are stable.

Until a packaged release exists, the source-run workflow is the supported path.
