# Git Operations Design

Date: 2026-06-05

## Goal

Add daily Git operations to Worktree Console for registered projects and their visible worktrees:

- fetch
- pull
- push
- stage
- unstage
- commit
- stash

The first version must avoid merge, rebase, checkout, branch creation, force push, conflict resolution, and remote management. It should make common local workflows faster without turning the console into a full Git client.

## User Experience

Add a `Git` tab to the selected project inspector. When the `Git` tab is active, the inspector enters a wide focus mode similar to the existing changes/diff focused mode.

The approved wide layout contains:

- Project header and existing inspector tabs.
- `Sync` card with current branch, upstream, last fetch time, ahead/behind counts, and `Fetch`, `Pull`, `Push` controls.
- `Stash` card with compact `Stash` and `List` controls.
- Three-column work area:
  - `Unstaged` changed-file list with per-file `Stage` and `Stage all`.
  - `Diff Preview` for the selected changed file.
  - `Staged` changed-file list with per-file `Undo`, `Unstage all`, commit message input, and `Commit` button.

Containment rules:

- The wide Git tab must not overflow the visible app frame.
- Grid columns must use `minmax(0, ...)` and children that can shrink must use `min-width: 0`.
- Long file paths must truncate with ellipsis.
- Per-file action buttons must be compact enough to avoid stretching rows.
- On narrower viewports, Stash can collapse and Diff Preview can appear only after selecting a file.

## Git Safety Rules

All Git commands run only inside a registered project path or a worktree path already returned by that registered project snapshot.

No command accepts an arbitrary filesystem path from the browser. The API must re-read the project snapshot and match the requested worktree path before running Git.

Operations:

- `fetch`: allowed for clean or dirty working trees because it does not modify local files.
- `pull`: allowed only when the target has an upstream branch, no uncommitted changes, and no diverged state. If Git reports conflicts or refuses the pull, surface the error and record the failed activity.
- `push`: allowed only when the target has an upstream branch and is ahead of upstream. No force push in the first version.
- `stage`: allowed only for files reported by `git status --porcelain=v1` in the target snapshot.
- `unstage`: allowed only for files reported as staged in the target snapshot.
- `commit`: allowed only when staged files exist and the commit message is non-empty after trimming. The API must not pass the message through shell interpolation.
- `stash`: allowed only when local changes exist. First version supports creating a stash from current local changes and reading the stash list. Applying or dropping a stash requires a later design or a confirmation flow.

Every mutating operation records an Activity event with project, target worktree, action, status, and concise detail. Failed operations also record Activity with status `failed`.

## Data Model

Extend shared types with a Git operation snapshot per project/worktree:

- `sync`: current branch, upstream, ahead count, behind count, last fetch metadata when available.
- `changes`: changed files split into staged and unstaged views, using existing `ChangedFile` information where possible.
- `stash`: stash count and recent stash entries.
- `operationState`: client-only busy/error state for buttons and forms.

The backend should derive this from Git on demand instead of persisting Git state. Registry JSON must not store Git operation details.

## API Design

Add project-scoped routes under `/api/projects/:id/git`.

Read routes:

- `GET /api/projects/:id/git/status?path=<worktreePath>`
- `GET /api/projects/:id/git/diff?path=<worktreePath>&file=<filePath>`
- `GET /api/projects/:id/git/stashes?path=<worktreePath>`

Mutation routes:

- `POST /api/projects/:id/git/fetch`
- `POST /api/projects/:id/git/pull`
- `POST /api/projects/:id/git/push`
- `POST /api/projects/:id/git/stage`
- `POST /api/projects/:id/git/unstage`
- `POST /api/projects/:id/git/commit`
- `POST /api/projects/:id/git/stash`

Mutation request bodies include a target worktree path when the operation is worktree-specific. Stage and unstage include one file path or an explicit `all` option. Commit includes a commit message. Stash includes an optional message.

Responses return the refreshed Git status for the target so the UI can update silently without a full dashboard flash.

## Backend Components

Extend `src/server/git.ts` with shell-safe `execFile` helpers for the new commands:

- `readGitOperationStatus`
- `fetchRepository`
- `pullRepository`
- `pushRepository`
- `stageFiles`
- `unstageFiles`
- `commitStagedFiles`
- `createStash`
- `readStashes`

Extend `src/server/app.ts` with routes that:

1. Resolve the registered project.
2. Rebuild or read the current project snapshot.
3. Validate that the requested path belongs to the project or one of its listed worktrees.
4. Validate file paths against the current Git status when staging or unstaging.
5. Execute the Git helper.
6. Record Activity.
7. Return refreshed Git status or a clear error.

Keep route handlers thin. If `app.ts` grows too much, add `src/server/gitOperations.ts` for route-level orchestration.

## Frontend Components

Add `git` to the inspector tab model.

Create a focused `GitPanel` inside `src/App.tsx` initially, with helper extraction if the component becomes large:

- `SyncCard`
- `StashCard`
- `GitChangesList`
- `GitDiffPreview`
- `CommitBox`

Add client calls to `src/lib/api.ts`.

Add UI helper tests for:

- splitting staged vs unstaged labels
- button disabled states
- compact action labels
- wide-mode layout class selection

## Error Handling

Show API errors as compact inline banners inside the Git tab. Do not use native browser alerts.

Expected error cases:

- no upstream branch
- dirty tree blocks pull
- branch is behind or diverged before push
- no staged files before commit
- empty commit message
- file no longer appears in Git status
- Git command fails due to conflicts, hooks, authentication, or remote rejection

When a Git command fails, keep the user on the same Git tab, keep their commit message if relevant, and refresh status after the error when safe.

## Testing

Backend tests:

- status separates staged and unstaged files
- stage and unstage validate files against current status
- commit rejects empty message and succeeds with staged files
- stash rejects clean worktree and creates stash for dirty worktree
- fetch is allowed on dirty worktree
- pull is blocked on dirty worktree or missing upstream
- push is blocked when no upstream exists
- Activity records success and failure

Frontend/helper tests:

- Git tab uses wide focused layout
- long filenames truncate instead of expanding rows
- commit button disabled state
- pull/push disabled state labels

Verification:

- `npm test`
- `npm run build`
- browser verification at `http://127.0.0.1:5273/`

## Out Of Scope

- merge
- rebase
- checkout
- create branch
- force push
- conflict editor
- stash apply/drop
- remote setup
- credential management
- Git LFS-specific flows
