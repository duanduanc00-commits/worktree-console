# Security Policy

Worktree Console is a local-first tool that can read Git repositories, inspect local ports, run configured commands, and remove Git worktrees or branches after confirmation. Treat it as a trusted local developer tool.

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

Runtime data is local-only and ignored by Git:

- `data/projects.json`
- `data/activity-log.json`

These files may contain project paths, service commands, ports, and operation history. They should not be shared publicly without review and redaction.

## Security Boundaries

- The app tracks only projects registered by the user.
- The app must not scan the whole machine automatically.
- The app must not upload local registry or activity data.
- Destructive Git actions must require safety assessment and confirmation.
- The service controls must not stop external processes that were only detected by port.
