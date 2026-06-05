# Security Policy

Worktree Console is a local-first tool that can read Git repositories, inspect local ports and process trees, run configured commands, stop matched local service processes, and remove Git worktrees or branches after confirmation. Treat it as a trusted local developer tool.

## Supported Versions

Security fixes are handled on the `main` branch until the project starts publishing versioned releases.

## Reporting A Vulnerability

Please do not open a public issue with exploit details.

If GitHub private vulnerability reporting is enabled for this repository, use that flow. Otherwise, open a public issue titled `Security contact request` with a brief, non-sensitive summary and ask for a private contact path.

Include when safe:

- Affected commit or version.
- Operating system.
- Impact summary.
- Minimal reproduction steps without secrets or private paths.

Do not include:

- Access tokens or credentials.
- Full local project paths if they are sensitive.
- Service commands containing secrets.
- `data/projects.json`, `data/activity-log.json`, or log files.

## Local Data And Privacy

Runtime data is local-only and may contain sensitive machine details.

The packaged `npx worktree-console` runtime stores no data in the repository by default. It stores local data here:

- Windows: `%LOCALAPPDATA%\Worktree Console`
- macOS: `~/Library/Application Support/Worktree Console`
- Linux: `$XDG_DATA_HOME/worktree-console` or `~/.local/share/worktree-console`

Source development runs store local data under ignored repository files by default:

- `data/projects.json`
- `data/activity-log.json`

These files and directories may contain project paths, service commands, ports, and operation history. They should not be shared publicly without review and redaction.

## Security Boundaries

- The app tracks only projects registered by the user.
- The app must not scan the whole machine automatically.
- The app must not upload local registry or activity data.
- Destructive Git actions must require safety assessment and confirmation.
- The service controls must not stop unknown external processes that were only detected by port. Externally started processes may be stopped only after the backend matches the listening process tree to the registered project path or service working directory.
