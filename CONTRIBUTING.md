# Contributing

Thanks for considering a contribution to Worktree Console.

## Local Setup

Prerequisites:

- Node.js 22 or newer. npm is included with Node.js.
- Git installed and available from your shell.
- For the default URLs, local ports `5273` and `4217` should be available.

```powershell
npm install
npm run dev
```

Default local URLs when the default ports are available:

- Frontend: `http://127.0.0.1:5273`
- API: `http://127.0.0.1:4217`

If port `5273` is already in use, Vite may print a different frontend URL in the terminal. If port `4217` is already in use, set `PORT` for the API and update the `/api` proxy target in `vite.config.ts` to the same port.

## Before Opening A Pull Request

Run:

```powershell
npm test
npm run build
git diff --check
```

For UI changes, also verify the running app in a browser.

## Contribution Guidelines

- Keep the app local-first. Do not add telemetry, hosted storage, or automatic whole-disk scanning.
- Keep Git cleanup conservative. Destructive worktree and branch actions must stay behind safety checks and confirmation.
- Keep diff responses bounded and scoped to files reported as changed by the matching worktree snapshot.
- Do not commit local runtime data from `data/`, `work/`, `outputs/`, generated logs, or machine-specific registry files.
- Prefer small helper modules with tests over adding more logic directly to `src/App.tsx`.

## Pull Request Scope

Please keep pull requests focused. Good PRs usually include:

- A short description of the user-visible change.
- Tests for new helper logic or API behavior.
- A note about manual browser verification for UI changes.

## Reporting Bugs

Use the bug report issue template and include:

- Operating system and shell.
- Node.js version.
- The project type you registered.
- The exact action you took.
- Any console or API error message.

Do not include private project paths, service commands, tokens, or logs unless you have redacted them.
