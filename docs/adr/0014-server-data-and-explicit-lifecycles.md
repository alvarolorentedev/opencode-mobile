# ADR 0014: Scoped server data and explicit application lifecycles

- Status: Accepted
- Date: 2026-10-31
- Deciders: maintainers
- Supersedes: —
- Related: [Provider ownership](0002-provider-centric-orchestration.md), [Realtime](0004-sse-with-polling-fallback.md), [State and data](../architecture/state-and-data.md)

## Context

Retained workspaces duplicate routine response storage and connection coordination.
Readiness polling also makes navigation depend on React publication timing.
Generic server caches and application workflows need separate owners.

## Decision

Use TanStack Query for routine server reads, with connection, authentication,
protocol and directory partitions. Retained/background workspaces remove their Query observers
(and held results) with empty query lists; query polling and automatic mutation replay stay disabled.
Existing domain contexts expose query-derived views without mirrored caches.

Use explicit React transitions for connection, workspace activation and Cloud
Link coordination. Resolve readiness from committed publications and propagate
cancellation through supported transports, retaining operation generations.
One connection owner supplies all retained projects. One shared SSE transport
continues to feed independent project-level reconciliation.

Keep sessions, transcripts, diffs, prompt admission, approvals, PTYs and voice
in their existing workflow owners. Native billing eligibility, purchases and
entitlement checkpoints remain outside routine query catalogs.

## Consequences

Server-data changes use ordinary typed queries and targeted invalidation.
Credential rotation replaces query partitions without remounting presentation
state. Capability snapshots retain their timestamps and cannot overwrite newer
network results. Existing persistence formats and protocol boundaries remain.

## Alternatives considered

- Keep bespoke caches: preserves duplicated request and freshness coordination.
- Put every workflow in Query: obscures streaming, uncertain writes and native checkpoints.
- Add XState: adds actor integration without removing the native transaction boundaries.
- Add Redux or Zustand: introduces another shared state owner.

## Rollback

Revert the migration and query-foundation commits together. Query data is
memory-only and persisted DTO versions remain unchanged; retain secure
credentials and preferences. No new native module or native build is required.

## Follow-up

Keep native purchase/entitlement and device lifecycle validation in the existing
manual workflow. Changes to browser/fake-server contracts retain the explicit
maintainer validation required by the repository agent instructions.
