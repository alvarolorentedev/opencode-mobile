# ADR 0025: Server-exposed plugin commands

- Status: Accepted
- Date: 2026-11-03
- Deciders: maintainers
- Supersedes: —
- Related: [issue 98](https://github.com/alvarolorentedev/opencode-mobile/issues/98), [API contract](../architecture/api-contract.md#server-plugin-commands), [ADR 0003](0003-v2-first-protocol-boundary.md)

## Context

V2 plugins register commands in the server's effective location-scoped registry.
A cached-name check in Mobile can miss new registrations and send slash text as
an ordinary prompt. TUI commands also include actions with no server API.

## Decision

Use the existing server command catalog and session command operation for V2
plugin compatibility. Let the server resolve names/overrides and report unknown
commands; never turn a rejected command into a prompt. Revalidate catalogs on
demand/lifecycle transitions and authoritative events through existing Query
owners, without command polling or a second registry. Preserve V1 behavior.

## Consequences

Server-exposed commands and hooks work without executing plugin code on Mobile.
Autocomplete can briefly lag a server change, but execution is authoritative.
Compatibility excludes TUI/desktop UI and unavailable APIs. Real-server fixture
coverage complements deterministic UI and lifecycle tests.

## Alternatives considered

- **Mobile plugin runtime or hardcoded TUI parity:** duplicates server behavior
  and cannot represent UI-only handlers through the command API.
- **Continuous catalog polling:** unnecessary when update events and lifecycle
  revalidation already provide the relevant refresh points.

## Follow-up

- [x] Document the compatibility boundary and real-server validation.
- [x] Cover command routing, lifecycle refresh and a real V2 plugin.
- [x] Expose V2 `session.compact` and `session.generate` as the `/compact` and
  `/btw` built-ins. This is not general TUI parity: other TUI commands still
  need a server API before they can be listed or executed.
