# ADR 0034: Device-local project archive marker

- Status: Superseded by ADR 0038
- Date: 2026-11-05
- Deciders: maintainers
- Supersedes: —
- Related: [ADR 0033](0033-server-driven-projects-and-sessions.md), [ADR 0030](0030-server-archived-projects.md), [State and data](../architecture/state-and-data.md#project-and-session-identity-state), [Functional specification](../product/functional-spec.md#2-pick-a-project)

## Context

Projects are derived from the server catalog (ADR 0033): the device keeps no
opened-project list, active-project pointer, or last-session map. Users still
want to remove a server project from their own picker without changing the
server, as they can favorite a chat without a server flag. The server has no
project archive write; `project.update` has no archived field. Server-archived
projects remain a separate read-only catalog.

## Decision

Add one device preference that complements [ADR 0033](0033-server-driven-projects-and-sessions.md)
rather than superseding it: a hidden-project map keyed by connection scope. The
server catalog remains the only source of project rows.

- Persist `opencode-mobile.hidden-projects` as a connection scope to project
  path list. Validate it with a zod boundary, trim, dedupe, and cap each list at
  50 entries. Favorites remain the other local preference.
- The picker intersects the server catalog with the hidden set. A hidden path
  that the server no longer reports renders nothing and is inert; it never
  creates a row or hides a different project. No pruning is required.
- Main rows expose "Archive on this device". Hidden server projects move to a
  collapsed "Archived on this device (N)" section with Restore. Search expands
  and filters that section.
- The server-archived section keeps its separate "Archived on OpenCode" label
  and `project.list({ archived: true })` read. A project can carry both markers;
  because the normal catalog excludes server-archived projects, the server
  archived section wins until it is restored.
- Hiding the active project activates the first remaining visible server
  project on that connection. If none remains, the selection stays; the next
  picker open still uses the server-derived default. No active pointer is
  persisted and there is no clear-focus API.
- Connection-scope refreshes migrate the hidden markers with the same scope
  migration used for favorites.

## Consequences

Users can declutter a device without changing server state or showing rows the
server does not report. The hidden set is device-local and does not sync. A
hidden marker that outlives its project is harmless; it simply matches nothing.
The cost is one more persisted preference and a second archived-style section
that must stay visibly distinct from the server-archived section.

## Alternatives considered

- **Rekey project identity to a server project ID:** rejected because stored IDs
  could later hide a different project; paths match the rendered catalog
  directly, and stale paths are inert.
- **Add or emulate a server archive write:** rejected; the server exposes no
  archive field and the app must not edit canonical directories or invent an
  unsupported mutation.
- **Restore the opened-project registry:** rejected; it is the second source of
  truth ADR 0033 removed. This marker only subtracts from the server catalog.
- **Persist the active project when the hidden row was active:** rejected;
  activation uses the remaining server catalog and the next cold start keeps
  deriving from the server.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add storage, split-helper, persistence, and picker flow coverage.
- [x] Link this ADR from the change summary.
