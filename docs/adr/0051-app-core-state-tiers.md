# ADR 0051: App core with Query for server facts and Zustand for device facts

- Status: Accepted
- Date: 2026-11-21
- Deciders: maintainers
- Supersedes: —
- Related: [ADR 0014](0014-server-data-and-explicit-lifecycles.md), [ADR 0015](0015-feature-oriented-implementation.md), [State and data](../architecture/state-and-data.md), [Architecture overview](../architecture/overview.md)

## Context

ADR 0002 made provider-centric orchestration the domain layer; ADR 0015 kept that ownership and moved implementation into features. React hooks became the composition mechanism: `use-opencode-provider-composition.ts` wires fifteen domains, `opencode-provider-values-input.ts` declares 86 inputs, and the domain contexts expose 126 members. Cross-domain commands such as sending a prompt or opening a session take most of that surface because a hook cannot be constructed with explicit ports.

That mechanism has outgrown its guardrails. The 60-line provider cap and 500-line file cap are satisfied by splitting files, not by reducing coupling. `{...domain}` spreads hide which hook reads which state, so a change can alter behavior in files nobody edited. Sessions and statuses have two authorities (a connection-wide catalog and a per-project React list) merged by hand at each display surface. The static ratchets see import edges and line counts, but not the runtime coupling that produces the regressions.

TanStack Query already owns routine server data (ADR 0014). Sessions, statuses, transcripts, diffs, todos and interactions are the exception, mirroring server facts into React state with custom coalescing, generation guards and session caches.

## Decision

Split state into two tiers with one app-level composition root:

1. **Server facts live in TanStack Query only.** Projects, capabilities, files, sessions, session statuses, messages, diffs, todos, permissions, questions, inbox and notices use Query keys scoped by connection, auth revision and contract. Do not mirror a Query response into another store.
2. **Device facts live in a Zustand vanilla store only.** Connection records and focus, project/session selection, preferences, favorites, hidden projects, drafts and scroll, prompt admission, conversation and terminal state are device or user decisions. One store instance per app core, sliced by domain; commands are plain functions with explicit ports, and React reads selectors.
3. **`runtime/core/create-app-core.ts` is the only app composition root.** It constructs the store, the Query client and the connection managers. React mounts it once. A per-workspace provider subtree is not the state owner; a workspace is a key.
4. **Commands are not hooks.** A hook may adapt a command for a component, but cross-domain behavior is a function that takes `{ store, queryClient, connections, clock }`.
5. **Migration is phased and adapter-based.** Existing domain contexts may read from the core while their consumers move; they may not gain new state. Remove an adapter when its last consumer moves.

Zustand is an approved dependency for this role. Redux, Redux Toolkit and XState remain retired unless a later ADR reopens them. This ADR refines ADR 0015's state mechanism; feature ownership, public APIs and import boundaries are unchanged.

## Consequences

- A fact has one owner file and one write path. Session status is written once and selected everywhere.
- Change impact is compiler-visible through explicit command ports and Query keys. Runtime coupling becomes a type error or a failing integration test instead of a silent spread.
- Query replaces custom deduplication, coalescing, stale-response generations and per-project session caches.
- Cross-domain behavior can be tested in plain TypeScript; E2E returns to user journeys and platform behavior.
- Query retention and persistence become continuity policy. Session/message keys need an explicit `gcTime` and hydration budget; inline message media must never enter the persisted cache.
- Connection lifecycle, SSE and credential renewal move out of React and must not leak streams or double-connect on auth rotation.
- `config/architecture.json` no longer retires `zustand`; the architecture checks should add tier rules as each adapter is removed.

## Alternatives considered

- **Keep the provider composition and only replace `{...domain}` with explicit inputs:** improves visibility, but hooks remain the only way to construct commands and the 86-input mirror remains.
- **Redux or Redux Toolkit as the single store:** solves selectors and testability, but replaces the ownership model and adds ceremony for async cancellation without removing the two-tier split.
- **XState for every lifecycle:** useful for connection and conversation machines, but adds a second paradigm for state that is already expressible as typed reducers.
- **Query for device state as well:** one cache, but misuse of a server-state library for user decisions and no commands or actions.
- **A dependency-injection container:** constructs objects, not state propagation; it would add indirection without removing the hook graph.

## Follow-up

- [x] Add `runtime/core` and mount the app core once.
- [x] Move workspace shell preferences into the app store.
- [x] Move session lists and statuses to Query and delete the per-project authority.
- [x] Move the workspace registry and focus into the app store.
- [x] Move per-workspace session selection into the app store.
- [x] Move the active project path into the app store selection.
- [x] Move the presentation map into the app store.
- [x] Move pending approvals into Query.
- [x] Add tier checks for the app store and server-state ownership.
- [ ] Add the cross-tier integration harness.
- [ ] Move connection lifecycle and SSE into connection managers.
- [ ] Extract prompt, session and workspace commands from the composition.
- [ ] Move canonical transcripts to Query with a live overlay store.
- [ ] Delete the domain contexts and the shared UI runtime exception.
- [ ] Update the state, boundary and runtime guidance as each phase lands.
