# providers/

Read the [state and data model](../docs/architecture/state-and-data.md#state-ownership-overview)
before changing provider state. This file is a map, not a second specification.

## Ownership layers

- `workspace-provider.tsx` owns the app-wide registry: connection profiles,
  hydration, focus, persistence, native surfaces, and the single voice-test
  instance.
- `use-workspace-connections.ts` owns explicit connect/disconnect, restoration,
  composite connection/project identity, and focus failover.
- `connection-runtime.tsx` owns one connection lifecycle and active catalog;
  `providers/queries/` owns routine server reads and targeted invalidation. Hidden retained
  workspaces disable and unsubscribe observers.
- `workspace-runtime.tsx` mounts one retained runtime per connection/project
  branch. Its clients, generations, transcript windows, prompt inbox, approvals,
  file selection, and PTY connections stay separate.
- `use-opencode-provider-composition.ts` composes the domain hooks;
  `opencode-provider.tsx` stays a thin wrapper.
- `opencode-contexts.ts` exposes domain contexts. `opencode-provider-types.ts`
  is the public contract; do not widen it casually.
- `providers/services/` aggregates requests. It does not own app state.
- `lib/opencode/` owns client construction, protocol types, and normalization.
  Compatibility branching belongs in `lib/opencode/contracts/` or
  `lib/opencode/compat/v1/`.

## Add or change a field

Edit in this order:

1. `opencode-provider-types.ts` — public type.
2. `opencode-provider-values.ts` — value assembly.
3. `use-opencode-provider-composition.ts` and the owning domain hook — wiring.
4. `use-opencode-persistence.ts` / `persistence-hydration.ts` — only if the
   field survives relaunch.
5. `opencode-contexts.ts` — expose it through the narrowest domain.
6. `opencode-provider-selectors.ts` — derived data.
7. `tests/fake-opencode/` — endpoint or fixture.
8. Targeted Vitest, then E2E if the user flow changed.

## Rules

- One owner per state. Do not copy provider-derived state into a component.
- No fetch, credential persistence, or protocol shaping in `app/` or
  `components/`.
- Persist only through the persistence hook; keep keys in `lib/storage-keys.ts`.
- SSE is primary; polling is the safety net. Do not remove the polling fallback.
- New API-dependent features are V2-only. Do not add a V1 adapter or fallback.
- The architecture ratchet caps the combined domain-context surface at 127
  members. Add a domain hook or action instead of widening it.
- Keep source files under 500 lines and `opencode-provider.tsx` under 60.

## Validate

```bash
npx vitest run tests/vitest/provider-runtime.test.ts tests/vitest/persistence-hydration.test.ts
npm run test:fake-server:self   # when the contract changed
npx playwright test tests/e2e/<domain>.spec.mjs
```

Changes under `tests/e2e/` or `tests/fake-opencode/` require explicit human
validation. See the [provider recipe](../docs/engineering/task-recipes.md#provider-state-field-or-endpoint).

## Pitfalls

- A second source of truth for a derived value.
- Persisting a key without a hydration test.
- Reconfiguring `NetInfo` inside a per-workspace runtime; `WorkspaceProvider`
  owns the single connectivity monitor.
- Subscribing presentation state to the changing workspace registry.
- Adding compatibility branches outside the typed adapter.
