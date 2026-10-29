# ADR 0003: V2-first protocol boundary with isolated V1 compatibility

- Status: Accepted
- Date: 2026-10-29
- Deciders: maintainers
- Supersedes: —
- Related: [API contract](../architecture/api-contract.md), [AGENTS.md](../../AGENTS.md)

## Context

OpenCode 2 is the primary server contract, but the app still supports existing
OpenCode 1 servers for behavior that already shipped. The two contracts differ
in endpoints, pagination, transcript records, diffs, inbox delivery, provider
authentication, and event shapes. Allowing compatibility branches to spread
through providers and components would make every feature carry two code paths
and would make the V1 surface grow accidentally.

## Decision

Make OpenCode 2 the primary contract and isolate V1 compatibility.

- Native V2 operations use `@opencode/client` through the typed adapter in
  `lib/opencode/`.
- `@opencode-ai/sdk` is imported only inside `lib/opencode/compat/v1/`.
- Contract branching belongs in the typed adapter or the V1 compatibility
  layer, never in screens, components, or provider hooks.
- New capabilities that require an API surface outside the existing V1
  compatibility layer are V2-only. The UI hides or disables them on V1.
- Do not add new V1 adapters, endpoint shims, fallbacks, or fake-server handlers
  for new V2-only capabilities.
- Contract discovery probes V2 first and falls back only for missing endpoints
  or malformed protocol responses, never for authentication or transport
  failures.

## Consequences

- New features ship once, against the current contract.
- V1 remains supported for existing behavior and maintenance fixes, but its
  surface is frozen unless a deliberate decision expands it.
- Protocol normalization stays testable and close to `lib/opencode/`.
- Fake-server and E2E coverage must continue to exercise both contracts where
  behavior is shared.

## Alternatives considered

- **Implement every new feature on both contracts:** doubles the work and keeps
  the legacy surface growing.
- **Drop V1 immediately:** simplest code, but breaks existing users and
  connections.
- **Branch on contract everywhere:** local convenience, but spreads protocol
  knowledge into UI and provider code.
- **A separate V1 app:** isolates the code but duplicates the entire product.

## Follow-up

- [x] Keep V1 imports inside `lib/opencode/compat/v1/`.
- [x] Add an architecture ratchet against V1 SDK imports outside the boundary.
- [ ] Revisit the V1 support policy only through a new ADR.
