# ADR 0040: Connection-owned Mission Control activity

- Status: Accepted
- Date: 2026-11-08
- Deciders: maintainers
- Supersedes: —
- Related: [State and data](../architecture/state-and-data.md#mission-control-activity), [Network resilience](../architecture/network-resilience.md#mission-control-reconciliation), [Functional specification](../product/functional-spec.md#mission-control)

## Context

OpenCode Mobile needs to surface actionable conversations across connections. The
Chat library's recent rows and per-project transcript state cannot represent all
pending requests or distinguish idle sessions from confirmed outcomes.

## Decision

Derive Mission Control and the tab badge from the existing connection runtimes,
session catalogs, and shared V2 streams. Only Mission visibility enables the
additional safety poll. Foreground approval reconciliation also supplies the
badge while users work in other tabs.

Treat V2 outcomes and execution events as settlement evidence. Keep transient
activity in memory and write a separate counts-only Android widget snapshot with
an observation time. The headless widget only reads that snapshot.

## Consequences

Counts exclude stale and sessionless requests. Partial reads preserve the
activity that can still be confirmed. The widget remains a dated view while
the app is suspended. V1 continues to work through its existing surfaces.

## Alternatives considered

- A transcript scan would increase data use and infer outcomes from unrelated
  message state.
- A widget-owned network client would duplicate credential handling and bypass
  application foreground and connection lifecycle gates.
