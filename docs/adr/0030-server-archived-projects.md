# ADR 0030: Server-archived project visibility without a client archive write

- Status: Accepted
- Date: 2026-11-04
- Deciders: maintainers
- Supersedes: —
- Related: [API contract](../architecture/api-contract.md#project-and-sessions), [Functional specification](../product/functional-spec.md#2-pick-a-project), [Projects feature](../../features/projects/AGENTS.md)

## Context

OpenCode archives a project automatically when its known directories have been
missing for an hour. The server marks it with `time.archived` and excludes it
from the default `project.list()` result. Resolving the directory through
`location.get` clears the marker.

The V2 protocol has no endpoint that archives or deletes a project on demand.
`project.update` accepts canonical, name, icon, and commands only. The desktop
web UI's "Other projects" section is not a server archive; it is the local set
of server projects this client has not opened, and its Close action only removes
a project ID from that local set.

The pinned `@opencode/client` 2.0.16 cannot request archived projects or read
`time.archived`. Version 2.2.5 exposes `project.list({ archived: true })` and the
archived timestamp.

## Decision

Upgrade the V2 client to 2.2.5 and expose server-archived projects as a
read-only, on-demand catalog behind a picker toggle.

- The normal project list stays on the server's default `project.list()`, which
  already excludes archived projects.
- The archived list is fetched with `project.list({ archived: true })`, filtered
  to entries with `time.archived`, and never persisted.
- Restore calls `location.get` for the archived directory. It works only when
  the directory exists again; failure keeps the row and reports the server
  reason.
- The app does not add a user-triggered archive action. The existing close action
  remains local to the device and does not touch the server.
- The archived list is V2-only. V1 connections hide the toggle.

## Consequences

Users can discover and restore projects the server archived, instead of having
to remember and retype the directory. The normal list keeps its existing
semantics and cache invalidation, and the archived query shares the `projects`
event resource so `project.updated` refreshes both.

The client upgrade is a generated-protocol change: the dependency, mappers,
contract tests, fake server, and full E2E gate must be updated together. Older
V2 servers that reject the `archived` query degrade to an unavailable archived
section without affecting the normal list.

## Alternatives considered

- **Local archive only:** rejected because it cannot show or restore projects
  the server already archived, and it remains device-scoped.
- **Add an archive action to `project.update`:** rejected because the server
  type has no archived field and the app must not invent an unsupported write.
- **Delete or move the project directory to trigger the sweep:** rejected as
  destructive and outside the app's authority.
- **Keep the pinned 2.0.16 client:** rejected because archived projects cannot be
  read at all; the user chose the upgrade.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add fake-server coverage for archived listing and restore.
- [x] Link this ADR from the change summary.
