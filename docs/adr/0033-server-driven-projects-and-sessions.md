# ADR 0033: Server-driven projects and sessions without local registries

- Status: Accepted
- Date: 2026-11-05
- Deciders: maintainers
- Supersedes: [ADR 0032](0032-web-parity-project-picker.md)
- Related: [API contract](../architecture/api-contract.md#project-and-sessions), [Functional specification](../product/functional-spec.md#2-pick-a-project), [State and data](../architecture/state-and-data.md#project-and-session-identity-state)

## Context

ADR 0032 split the picker into Used and Other backed by a locally persisted opened-project list. That list is a second source of truth: any directory the app ever recorded renders as long as the local store says so, which is exactly how the phone showed projects (`/home/alvarolorentedev`, deleted folders, old temp dirs) the web client never listed. Patching the symptoms (hiding stale rows, an Unavailable cleanup section) keeps the registry and its drift.

## Decision

Project and chat identity comes from the server catalogs only. The app deletes its project registries and keeps just one local exception.

- Delete the opened-project list (`opencode-mobile.projects`, `projects-storage.ts`, the `openProject`/write-back paths, `closeProjects`, and `projectClosedValues`), the active-project pointer, and the last-session map (`opencode-mobile.last-session-by-project`, `last-session-storage.ts`). Stored values from older builds are removed once on hydrate.
- The picker renders the flat server catalog in server order. Selecting only changes the active selection; there is no close action and no Unavailable section because nothing local can go stale.
- On connect the retained placeholder runtime derives the active project from the server: the server default location first, then the most recently active project (`time_active` is bumped by location boots and durable session events, so it tracks real usage). An explicit target the server still resolves (deep link, worktree) is kept.
- Opening a project without an explicit selection picks the newest session in the server `session.list` (which defaults to newest-first). The bootstrap and reconcile fallbacks that preferred a remembered session now use `sessions[0]`.
- Connections still mount one placeholder runtime each and create project runtimes on demand via `ensure()`; composer drafts are safe because they live in presentation state, not in runtimes. Nothing about mounted projects is persisted, so a restart always re-derives from the server.
- Favorites stay as the single local exception: the server has no favorite flag.

## Consequences

The phone can never show a project or chat the server does not report, and all devices converge on the server-most-recent project at cold start. The cost is the loss of per-device last-open restore: reopening the app after working elsewhere opens the server-most-recent project instead of the one this phone last showed. Session transcript, session-list, and capability caches stay as transparent server-confirmed caches.

## Alternatives considered

- **Auto-prune stale opens once inventories settle:** rejected as a half measure; the registry and its write paths remain, along with the race between inventory loads and pruning.
- **Keep the active-project pointer as one persisted string:** rejected per the server-most-recent decision; the pointer is exactly the local truth this ADR removes.
- **Drop favorites too:** rejected; there is no server field to replace them with, and they are explicit user marks rather than derived identity.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Update unit, persistence, and E2E coverage for the removed registries.
- [x] Link this ADR from the change summary.
