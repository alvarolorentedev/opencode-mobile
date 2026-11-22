# Phase B — Connection Manager

Status: **complete**. The plain managers own probe and credential renewal.
The app-core registry owns their lifetimes and credential partitions. Managers
schedule direct reconnect retry, demand-driven stale Query refresh, a single
SSE subscription, event invalidation and project polling. Independent catalog
projections and project adapters read the managers. Retained project adapters
continue to supply command callbacks until Phase C. The commit gate, fake-server
self-tests and all 185 browser flows passed.

Goal: move probe, credential renewal, SSE, polling, status refresh and event
dispatch out of React. One plain-TS manager per connection, started and stopped
by the registry, with no per-connection React subtree.

Read the [phase index](README.md), [state and data](../../architecture/state-and-data.md),
and [network resilience](../../architecture/network-resilience.md) first.

## Why this phase is delicate

A previous attempt at this extraction passed unit and connect-recovery tests but
regressed live renewal: after extending a Cloud Link entitlement and reopening
the panel, the Restore action stayed disabled. The attempt was reverted. The
same failure must be reproduced before the manager is accepted and must stay
green after it.

The Phase A export passes `connect.spec.mjs` for live renewal across panel
reopening, credential rotation and second-device Restore. The manager test
also exercises paused renewal and an immediately published credential revision.
The prior checkout was unavailable in the branch history, reflogs and dangling
commits. The existing browser scenario exercises the same Restore assertion,
and the recovery fixture checks the extended entitlement and ready state.

Do not start Phase B until Phase A is complete and the baseline gate is green.

## Target files

New files:

```text
runtime/connections/create-connection.ts
runtime/connections/registry.ts
```

Existing owners:
- `runtime/connections/connection-lifecycle.ts` — state machine; keep and test.
- `runtime/connections/connection-runtime.tsx` — current React owner; delete or
  reduce to a thin unused-free bridge by the end of the phase.
- `runtime/workspace/use-workspace-connections.ts` — registry/focus; remove
  connection-local concerns that move here.
- `runtime/persistence/connection-refresh.ts` — credential-scope migration.

## Manager responsibilities

Each manager owns:
- client construction for the connection contract;
- server probe and contract detection;
- connect/reconnect with operation generations;
- credential renewal scheduling and AppState handling;
- SSE subscription and reconnect;
- polling fallback and status refresh;
- query partition/cancellation on credential or scope changes;
- event dispatch into the core event handler;
- state through `connection-lifecycle.ts`, exposing `getState`/`subscribe`.

It must not import React or feature presentation. It may import protocol,
storage, Query and platform interfaces.

## Registry responsibilities

- Start one manager for each enabled connection record.
- Stop and dispose on disable, removal or app teardown.
- React to connection revision/auth revisions from the store.
- Never duplicate the single connectivity owner; the shell still samples NetInfo
  once.

## Steps

1. Add a manager constructor with explicit ports:
   - `queryClient`, `store`, `settings`, `connection id`, `clock`,
     `AppState`/foreground, `online`.
   - Callbacks for `updateSettings`, `onInvalidated`, event dispatch.
2. Move the connect/probe/renewal logic from `useConnectionLifecycle` into the
   manager. Keep behavior identical; do not “simplify” error classification or
   credential recovery in this phase.
3. Add a renewal/restore unit test that covers:
   - entitlement extension,
   - panel reopen,
   - credential rotation,
   - restore enabled after refresh.
4. Add a registry test for start/stop/dispose and revision changes.
5. Wire the registry in the app core. The shell may subscribe to manager state
   through a selector, but must not mount a transport.
6. Delete `ConnectionRuntime` and the lifecycle effects. Remove the
   per-connection provider subtree.
7. Run the owning browser flows, especially live renewal.

## Phase B gate

```bash
npm run validate:commit
npm run test:fake-server:self
EXPO_PUBLIC_E2E_MODE=1 EXPO_APP_VARIANT=development npm run build:web:ci
E2E_SKIP_BUILD=1 npx playwright test tests/e2e/connect.spec.mjs tests/e2e/realtime.spec.mjs tests/e2e/network-resilience.spec.mjs tests/e2e/multi-server.spec.mjs
```

The full 185-flow suite is required at this checkpoint.

## Acceptance

- No React component constructs or mounts a connection transport.
- One manager per connection, disposed on removal.
- Live renewal, reconnect, auth failure, offline and polling fallback pass.
- No duplicate SSE subscription or double connect on auth rotation.
- The connection state machine remains a plain, tested manager.

## Pitfalls

- Keep the current `connect.spec.mjs` live-renewal flow in the gate. The prior
  attempt failed only there.
- Do not move Query partition/cancellation without preserving the auth-revision
  keys.
- Do not combine this phase with command extraction. Small, revertible commits.
- Physical-device network handoff still needs manual validation; browser E2E is
  not native evidence.
