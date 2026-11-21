# ADR 0049: Bounded Mission Control statistics snapshots

- Status: Accepted
- Date: 2026-11-21
- Deciders: maintainers
- Supersedes: —
- Related: [State and data](../architecture/state-and-data.md#mission-control-activity), [Functional specification](../product/functional-spec.md#mission-control), [ADR 0042](0042-mission-server-aggregates.md), [ADR 0043](0043-react-native-chart-kit.md)

## Context

Mission Control showed a skeleton and reread every usage aggregate on each tab
visit and cold start. The chart window ended at `Date.now()` with millisecond
precision, so the Query key never repeated; leaving the tab also removed the
observers before the short cache lifetime expired. A single activity paint is
one range read plus up to six sequential bucket reads per server, and the
contribution card adds a 30-day read.

Those aggregates are historical and do not change continuously. Reloading them
from scratch wastes server work and makes the dashboard feel slow on every
launch and revisit.

## Decision

Keep the aggregate reads, but make their windows stable and retain the last
successful default view:

- Align the activity window to five minutes and anchor the contribution range
  to local calendar days. Keep statistical Query results for five minutes and
  render the previous window while a new one loads.
- Persist the last successful all-projects dashboard per connection scope for
  the default 24-hour activity range. Two keys hold only what the charts paint:
  token/cost totals and buckets, plus up to 31 daily `{date, steps}` rows.
  Conversations, project identifiers, approvals, questions and transcripts are
  never persisted.
- Bound each snapshot envelope to 24 hours, eight activity buckets, 31 days and
  16 KB. Malformed or expired values are deleted on read.
- Hydrate snapshots into the shared Query cache with their original timestamp so
  data paints immediately and is reconciled in the background. A hydrated
  snapshot never overwrites fresher data and is not written back as if it were a
  new read.
- Preserve snapshots across a connection-scope renewal and remove them when the
  connection is deleted. Project-filtered or non-default ranges are not
  persisted; they stay in the in-memory Query cache.

Live job and approval evidence keeps its existing connection-owned in-memory
ownership and is never restored from storage.

## Consequences

Returning to Mission repaints both charts from cache and reads in the
background. A cold start paints the last default view, then reconciles. The
first open of a new connection, or a project-specific view after restart, still
loads from the server. The aligned window can lag up to five minutes behind
`now`; the header refresh and the background read reconcile it.

Storage grows by at most two small entries per configured connection and is
cleared on removal. Credential renewal migrates the entries with the other
connection-scoped caches.

## Alternatives considered

- **Pause persistence and only extend the in-memory Query cache:** leaves the
  slow first load after every app restart, which was the reported problem.
- **Persist the whole Query cache:** adds a general persistence layer and stores
  project, range, transcript and approval-shaped data that Mission does not
  need.
- **Persist approvals or the job list:** a resolved request could reappear as
  pending, so live evidence must be reread.
- **Persist every project and range combination:** grows without a useful bound
  while the app always opens on the all-projects, 24-hour view.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add or update tests or fake-server coverage.
- [x] Link this ADR from the change summary.
