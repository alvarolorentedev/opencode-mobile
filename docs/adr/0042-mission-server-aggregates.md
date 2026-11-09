# ADR 0042: Server aggregates for Mission Control history

- Status: Accepted
- Date: 2026-11-09
- Deciders: maintainers
- Supersedes: —
- Related: [State and data](../architecture/state-and-data.md#mission-control-activity), [Functional specification](../product/functional-spec.md#mission-control)

## Context

Mission Control needs time-windowed usage across connections. Session summaries
hold cumulative usage and the latest outcome.

## Decision

Use the V2 experimental session stats endpoint through the connection's
authenticated client and canonical query partition. Each chart window uses one
range aggregate and up to seven sequential bucket aggregates per server. All
metrics share those results. The full range's distinct conversation count is
independent of the sum of bucket counts.

## Consequences

Reads are demand-gated by Mission focus and app foreground. Entry, resume,
reconnect, scope or range changes and explicit refresh reconcile the data.
Unsupported and failed servers reduce chart coverage. When a project has only
a directory and no verified project ID, history is unavailable at that scope.
Live status, the badge and the widget keep their connection-owned evidence.

## Alternatives considered

- A transcript scan would multiply requests and transfer message content.
- A device-side history store would provide incomplete coverage across devices
  and background periods.
