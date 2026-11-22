# Phase G — Harness and Guardrails

Status: **not started**.

Goal: prove the final architecture at the seam, encode its runtime invariants,
and close the documentation. This is the last phase; do not start it with any
earlier phase open.

Read the [phase index](README.md), [validation strategy](../validation/strategy.md),
and [ADR 0051](../../adr/0051-app-core-state-tiers.md) first.

## Full composition harness

Add a headless harness that starts the fake OpenCode server and mounts the real
core, Query client and selector/command seam. It must cover:

1. connect;
2. project catalog;
3. open/create session;
4. send prompt;
5. stream events (text/tool/approval);
6. reconnect/foreground recovery;
7. scope switch between two connections/projects;
8. dispose.

Target file:

```text
tests/integration/core-harness.test.tsx
```

Suggested tooling: `@testing-library/react` + `jsdom` (or an equivalent
renderer) with an injected transport. Do not mount React Native views; mount
headless probes that read selectors and call commands. If a tool cannot render
the provider without native modules, inject a test transport into the core
instead of mocking domain modules.

Existing smaller harnesses stay:
- `runtime/__tests__/app-core.test.ts`
- `features/sessions/__tests__/session-catalog.test.ts`

## Fact and command guardrails

Add a small ownership manifest, for example:

```text
config/ownership.json
```

Each fact names:
- the writer module;
- the Query key or store slice;
- the selector module;
- the allowed test owner.

Add source checks that reject:
- the same Query key or store writer duplicated outside its owner;
- server-data types in `useState` outside Query;
- UI importing `runtime/core` or the store directly;
- a command implemented as a hook after Phase C;
- a new cross-domain command without a harness scenario.

Keep `npm run impact` as the discovery tool; do not replace it with a second
module graph.

## Tier rules

Encode:
- `features/*/ui` may import feature selectors/queries/commands and shared UI;
- only feature `queries.ts`, `selectors.ts`, `commands.ts` may import the core;
- `runtime/core` may not import feature presentation;
- `shared/` may not import runtime;
- no compatibility shim or wildcard export.

Update `config/architecture.json` only for deliberate, documented policy
changes.

## Documentation and release

- Finalize ADR 0051 with every phase checked.
- Add ADRs for the connection manager, command core, transcript design and
  persistence policy if those decisions are not already captured.
- Update the state/boundary/network/validation docs to current behavior.
- Update the phase status table in [the index](README.md).
- Remove the temporary implementation notes that are no longer true.
- Run the commit gate and full release validation.

## Phase G gate

```bash
npm run validate:commit
npm run test:docs
npm run test:fake-server:self
npm run build:storybook
EXPO_PUBLIC_E2E_MODE=1 EXPO_APP_VARIANT=development npm run build:web:ci
E2E_SKIP_BUILD=1 npx playwright test
```

Native/release-risk changes also need the local native check when the toolchain
is available; the tag release is authoritative.

## Acceptance

- Harness covers the eight flows above and fails on a deliberate cross-domain
  regression.
- Ownership manifest and source checks reject duplicate writers and UI/core
  imports.
- Every phase in the index is complete.
- Full 185-flow E2E, Storybook, docs and static gate pass.
- `git status` is clean; commits are one per phase/sub-phase.

## Pitfalls

- Do not add a second harness that re-mocks the domain; it proves nothing.
- The harness must exercise the real Query cache and the real store.
- Guardrails must be runtime invariants; file-length ratchets alone are not
  enough.
- Do not claim completion if any phase status is still open.
