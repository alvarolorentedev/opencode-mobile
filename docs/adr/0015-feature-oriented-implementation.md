# ADR 0015: Feature-oriented implementation with shared runtime ownership

- Status: Accepted
- Date: 2026-10-31
- Deciders: maintainers
- Supersedes: ADR 0002, ADR 0005
- Related: [Feature boundaries](../architecture/feature-boundaries.md), [Server data](0014-server-data-and-explicit-lifecycles.md), [UI foundation](0013-source-owned-ui-and-complex-forms.md), [Documentation router](../README.md)

## Context

A product change currently spans technical directories containing unrelated domains.
Agents need local feature ownership without duplicating the multi-workspace runtime,
query data, shared session lifecycle or native device resources.

## Decision

Group domain implementation and its Vitest tests under `features/`. Keep Expo Router
entrypoints in `app/`, native modules in `modules/`, and infrastructure in `shared/`.
`runtime/` owns cross-feature state and lifecycle composition. It mounts the same
application, connection and retained connection/project owners as before. Settings
and Onboarding may compose public UI from other features; they do not own those
features' state.

Use bounded named consumer and headless APIs. Context entrypoints remain separate
leaves so scoped portals can restore the existing context objects without importing
root composition. Enforce declared acyclic feature dependencies and keep transport,
secret persistence and native side effects outside arbitrary presentation.

The existing scope-aware Portal, OverlaySheet, Select and AlertDialog controls, and
the existing catalog/confirmation blockers, may import only the exact symbols in
`runtime/ui.ts` allowed by the architecture test. This exception preserves portal
ancestry, context identity and update-blocking lifetimes. It adds no bridge context,
state owner or general permission for shared UI to depend on runtime.

Retain ADR 0014's query keys, ownership, observer demand and cancellation. Retain ADR
0013's source-owned components, token source, form libraries, native renderers,
portal behavior and accessibility. Only implementation locations change. Protocols,
persistence formats, native discovery, routes and supported platforms do not change.

## Consequences

Agents begin in a feature and consult documented shared interfaces. State and actions
remain mounted independently of screens. Tests move with their owner; central tests
verify that every suite still matches Vitest discovery and TypeScript checking.
Existing size and context limits and compatibility isolation continue across all new
source directories. Historical source paths in immutable ADRs are interpreted using
the coordinated migration inventory; current documentation must resolve directly.

## Alternatives considered

- Feature-local workspace runtimes: duplicates session, connection and device owners.
- Keep only technical directories: preserves the navigation cost for every feature.
- Forwarding modules or parallel implementation trees: leave competing conventions.
- A new state library or monorepo framework: unnecessary for ownership and import checks.
- A new UI context bridge: adds another contract to preserve behavior already supplied
  by the existing scope-aware controls.

## Rollback

Revert the coordinated migration PR. Data keys, serialized formats, native module
identifiers and protocol contracts are unchanged; no data conversion is needed.

## Follow-up

Keep the public export policy, scoped agent guidance and documentation router aligned
with implementation. Do not increase limits or add compatibility paths to resolve a
boundary failure.
