# Architecture

Back to the [documentation hub](../README.md).

How the app is composed, where state lives, and how it talks to OpenCode.

This section is for anyone changing provider behavior, session state, realtime
transport, persistence, or the client protocol. Read
[overview.md](overview.md) first, then the page that owns your concern.

## Documents

| Document | Owns |
| --- | --- |
| [overview.md](overview.md) | Runtime composition, module map, boot flow, screen/provider boundaries, realtime model, and cross-cutting invariants |
| [state-and-data.md](state-and-data.md) | Provider state ownership, persistence, derived data, transcript transformation, and capability discovery |
| [api-contract.md](api-contract.md) | OpenCode 2 contract, V1 compatibility boundary, endpoint usage, and request/response expectations |
| [network-resilience.md](network-resilience.md) | Connectivity, deadlines, SSE/polling recovery, offline queue, and cached reads |

## Where does this live?

| Concern | Owning layer |
| --- | --- |
| App-wide connection registry, focus, and persistence | `providers/workspace-provider.tsx`, `providers/use-workspace-connections.ts`, `providers/use-opencode-persistence.ts` |
| Provider-specific agent guidance | `providers/AGENTS.md` (loaded when working in `providers/`) |
| Routine server reads and connection lifecycle | `providers/queries/`, `providers/connection-runtime.tsx` ([ADR 0014](../adr/0014-server-data-and-explicit-lifecycles.md)) |
| Per-workspace domain orchestration | `providers/use-opencode-provider-composition.ts` and its domain hooks |
| Public domain contexts and hooks | `providers/opencode-provider-types.ts`, `providers/opencode-contexts.ts`, `providers/opencode-provider-tree.tsx` |
| Provider-facing API aggregation | `providers/services/` |
| Client construction, endpoint wrappers, protocol types | `lib/opencode/` |
| V1 compatibility only | `lib/opencode/compat/v1/` |
| Routing and thin screen wiring | `app/` |
| Presentation and local UI state | `components/` |
| Behavioral contract | `tests/fake-opencode/` and `tests/e2e/` |

## Rules

- The app is provider-centric. Domain state and orchestration belong in
  `providers/`, not in screens or presentational components.
- Keep protocol normalization close to `lib/opencode/`.
- Preserve the dual realtime model: SSE is primary, polling is the safety net.
- New API-dependent features are V2-only unless an existing V1 compatibility
  path already supports them. See [ADR 0003](../adr/0003-v2-first-protocol-boundary.md).
- If you change a boundary, protocol, or ownership rule, add an
  [ADR](../adr/README.md) and update the relevant page here.
- `tests/vitest/architecture.test.ts` enforces the size, context-surface,
  network/persistence, and compatibility boundaries. Fix a failure by moving
  code to the right layer; do not raise the limit.

## Change checklist

1. Identify the owning layer in the table above.
2. Read the matching document and the [state and data](state-and-data.md) page.
3. Make the smallest change that preserves documented behavior.
4. Update the fake server or E2E contract if the client contract changed.
5. Update this section and record any decision in `docs/adr/`.
6. Run the validation required by `AGENTS.md`.
