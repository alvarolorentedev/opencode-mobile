# ADR 0012: Shell-mediated project file actions

- Status: Accepted
- Date: 2026-10-30
- Deciders: maintainers
- Supersedes: —
- Related: [API contract](../architecture/api-contract.md#file-editing-and-worktrees), [state ownership](../architecture/state-and-data.md#project-file-browser), [issue 91](https://github.com/alvarolorentedev/opencode-mobile/issues/91)

## Context

V2 exposes filesystem listing, reading and writing but no rename, copy or move
endpoint. The Projects browser needs these operations, including copying between
worktrees on the same server, without moving orchestration into presentation.

## Decision

Use the existing V2 server-shell transport with a fixed, path-quoted POSIX
program owned by `lib/opencode/`. New mutations are unavailable on V1 and on
servers without the required shell utilities. Copy path remains device-local.

- `WorkspaceProvider` owns a process-local clipboard and mutation lock per
  connection; runtimes receive it through existing shared inputs. Disconnect,
  removal and settings changes clear that connection's clipboard.
- The browser's grouped actions own preflight, mutation and refresh orchestration.
  Swipe exposes Copy path, Rename and More; More and long-press use one actions
  sheet. Rename uses a focused sheet and Paste uses the browsed or selected folder.
- Validate project-relative paths and reject symlinks, special files, self-copy
  and nested destinations. Recursive sources containing symlinks are rejected.
- File replacement requires a destination fingerprint confirmed by the user and
  checked again before publication. Rename never replaces. Folder collisions
  never merge or replace, even after confirmation.
- Stage and verify copies before publication. Reserve new directory names with
  exclusive `mkdir`; a failed directory publication can leave a partial new copy,
  but never replaces an existing folder. Cut removes the source only after the
  published copy compares equal. Ambiguous results are reported without retries.

## Consequences

No dependency, compatibility adapter or persisted storage schema is added. File
operations have the existing shell time/output limits, so large directory copies
may fail. Shell commands cannot provide a transaction against concurrent external
filesystem edits. Errors retain the clipboard/input and distinguish uncertain or
partially completed moves from refresh failures. Both affected runtimes refresh
directory/search results, VCS status and active VCS diffs without changing focus.

Real-shell Vitest tests validate quoting, failure behavior and containment; the
V2 fake server models the positional program contract. Changed fake-server and
E2E contracts require human validation, plus real-server/device acceptance.

## Alternatives considered

- **Wait for upstream filesystem mutations:** cleaner contract, but blocks the
  requested feature. Revisit when native atomic operations exist.
- **Session shell commands or PTYs:** couple filesystem management to chats or
  interactive terminals rather than the existing scoped server-shell transport.
- **Directory overwrite or merge:** adds destructive ambiguity and rollback work
  unnecessary for the five core actions.

## Follow-up

- [x] Update owning implementation documentation and the ADR index.
- [x] Add real-shell, provider, fake-server and Projects flow coverage.
- [ ] Complete human and real-server/device acceptance before release.
