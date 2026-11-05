# ADR 0032: Project picker matches web Used/Other semantics

- Status: Accepted
- Date: 2026-11-05
- Deciders: maintainers
- Supersedes: —
- Related: [ADR 0030](0030-server-archived-projects.md), [API contract](../architecture/api-contract.md#project-and-sessions), [Functional specification](../product/functional-spec.md#2-pick-a-project), [Projects feature](../../features/projects/AGENTS.md)

## Context

The mobile picker built its list as the union of the locally opened projects and
the server catalog, so stale local opens (deleted folders, old temp dirs,
pre-upgrade entries) rendered as full rows. On a real server the phone showed
many more projects than the web client, whose settings list renders only the
server catalog split into used and a collapsed Other projects section.

## Decision

The picker renders the server catalog only, split per connection into Used
(opened on this device + connection, matched by root path or any known checkout
directory) and a collapsed Other projects section with its count, exactly like
the web client. Searching expands Other and filters every section.

Locally opened folders the server no longer reports never become rows. They are
listed in a collapsed "Unavailable on this server" section with remove actions
only, so selecting them cannot mount a runtime for a dead folder. Retained
runtimes whose root left the server catalog are likewise dropped from the rows
(while no runtime on the connection reports a catalog, active roots are kept so
a cold start never flashes empty). `buildOpencodeProjects` now maps the server
catalog in server order; the opened list only marks usage.

## Consequences

Phone and web show the same project set. Stale entries are cleanable instead of
confusing, and closing a project still only removes the local entry. The picker
query key and invalidation are unchanged; the archived-projects view is
unchanged.

Existing E2E expectations that asserted an unopened server project is visible
without expanding Other were updated to expand the section first.

## Alternatives considered

- **Keep the union and badge stale rows inline:** rejected because the main list
  stays inflated and diverges from the web client.
- **Auto-delete stale opens on catalog load:** rejected because a worktree
  inventory that has not loaded yet could make a live checkout look stale;
  hiding with an explicit remove action is safer.
- **Probe stale paths with `location.get` to revalidate:** rejected because
  resolving persists a project on the server as a side effect.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add picker-split unit tests and update the affected E2E specs.
- [x] Link this ADR from the change summary.
