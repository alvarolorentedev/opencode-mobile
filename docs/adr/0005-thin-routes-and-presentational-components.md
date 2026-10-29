# ADR 0005: Thin routes and presentational components

- Status: Accepted
- Date: 2026-10-29
- Deciders: maintainers
- Supersedes: —
- Related: [Architecture overview](../architecture/overview.md), [AGENTS.md](../../AGENTS.md)

## Context

Mobile screens tend to accumulate fetch logic, protocol parsing, persistence,
and shared state because those are convenient to reach from a route. That makes
behavior hard to reuse across tabs, hard to test outside the navigation stack,
and easy to duplicate. The app already has a provider-centric domain layer; the
route and component layers need a clear rule to keep it that way.

## Decision

Keep routes thin and components presentational.

- `app/` owns route entrypoints, tab/layout wiring, thin screen controllers, and
  calls into `useOpencode()` domain hooks. It does not fetch, persist, normalize
  protocol payloads, or own cross-session caches.
- `components/` owns rendering and local UI state (open sheet, search query,
  draft, expanded row, and similar). It does not call APIs, persist data, or
  create shared domain state.
- Shared behavior across tabs belongs in `providers/`.
- Protocol shaping belongs in `lib/opencode/`.
- Services in `providers/services/` aggregate provider-facing requests but do
  not own app state.

## Consequences

- Screens can be rebuilt or rearranged without moving domain behavior.
- Components are easier to preview in Storybook because they do not depend on
  the network or the workspace runtime.
- Some features require an explicit provider hook before the UI can be written;
  that is intentional friction.
- Architecture ratchets can detect fetch/persistence calls and legacy SDK
  imports in the wrong layer.

## Alternatives considered

- **Feature folders with co-located state:** good locality, but duplicates the
  provider and loses cross-tab continuity.
- **Container/presenter split only at the screen level:** helps a little, but
  still allows protocol and persistence logic to leak into screens.
- **Server-state hooks in components:** convenient for reads, but bypasses the
  provider's reconciliation and persistence rules.

## Follow-up

- [x] Keep the layering rules in `AGENTS.md`.
- [x] Keep the architecture ratchet for network and persistence calls.
- [ ] Add a provider hook or service before adding a new shared behavior to a
  component.
