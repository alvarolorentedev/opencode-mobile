# ADR 0038: One archived-projects switch in the project picker

- Status: Accepted
- Date: 2026-11-06
- Deciders: maintainers
- Supersedes: [ADR 0034](0034-device-local-project-archive.md)
- Related: [Functional specification](../product/functional-spec.md#2-pick-a-project), [State and data](../architecture/state-and-data.md#projects), [Chat components](../design/components/chat.md), [Screen components](../design/components/screens.md)

## Context

ADR 0034 added device-local hidden projects as a collapsed section that search
expanded, while ADR 0030 kept server-archived projects behind a separate switch
lower in the picker. The two controls made archive discovery unpredictable:
search could bypass the local switch, and the server switch sat after the whole
project list. The picker also scrolled the Add project action away with the
list.

## Decision

The project picker exposes one Show archived projects switch directly below its
search and server filters. It starts off on every open and reveals both archive
sources:

- device-local hidden rows under "Archived on this device (N)" with Restore;
- V2 server-archived rows under "Archived on OpenCode" with Restore.

Neither section is collapsible. Search filters the rows that the switch already
reveals; it no longer expands hidden rows on its own. The project list scrolls
internally, while the filters and switch stay fixed above it and Add project
stays pinned below it.

The hidden-project persistence, connection scoping, stale-marker behavior and
active-project fallback from ADR 0034 are unchanged.

## Consequences

Users have one predictable place to find both archive kinds. The local and
server sections stay visibly distinct because their restore semantics differ.
Because search no longer bypasses the switch, a hidden project is not found by
typing alone; the user must turn the switch on. The picker layout no longer
scrolls its primary add action out of view.

## Alternatives considered

- **Keep two archive controls:** rejected because the local section and server
  switch were easy to miss and behaved differently.
- **Merge local and server archived rows into one list:** rejected because local
  restore updates only the device marker, while server restore calls
  `location.get` and invalidates the shared catalog; one list would blur that
  difference.
- **Keep search auto-expanding local hidden rows:** rejected because it bypassed
  the switch and made visibility depend on the query.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Update the owning projects E2E flow.
- [x] Link this ADR from the change summary.
