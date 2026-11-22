# Phase F — Persistence and Tests

Status: **complete**. Query persistence, the session-cache removal, Zustand
device preference persistence, native test imports, property tests and the
platform-aware Knip cleanup are complete. The local Phase F checkpoint passed
at `c092ed88`; see the [validation handoff](README.md#validation-handoff).

Goal: one retention policy and one test infrastructure. No custom module loader,
no duplicate storage writer, no hand-written edge matrices where a property test
is clearer.

Read the [phase index](README.md) and [validation strategy](../validation/strategy.md)
first.

Start only after Phase E is complete and green.

## Already done

- Query persistence for session and project catalogs
  (`shared/server-data/persistence.ts`).
- Custom session cache and its hydration/write paths are deleted.
- Bounded transcript Query persistence omits inline media, and the previous
  transcript cache remains as a read-only upgrade path.
- `npm run impact -- <file>` exists.

- Zustand persist owns chat and presentation preferences, favorites, hidden
  projects, the trusted control-plane URL and the onboarding marker. The
  existing records migrate independently under one schema version. The app
  leaves unsupported newer records intact.
- Connection profiles retain their existing verifiers and secure storage.
  Query restoration and app-core hydration finish before the workspace shell
  routes to onboarding or the saved session.

## Completed migration scope

### `loadTs` and `hookRuntime` removal

All 87 legacy suites now use native imports, with the real React renderer where
needed. The migration retained test names and assertions, removed the custom
loader and its dead stand-ins, and kept mocks at platform boundaries.

### Property tests and dead-code cleanup

- `tests/vitest/state-properties.test.ts` covers the connection reducer, retry
  status merge, anchored transcript page merge and live overlay ordering with
  `fast-check`.
- Knip has a platform-aware config; the scoped reachability and unused-export
  checks passed. Generated locale resources remain exempt.

## Phase F gate

```bash
npm run validate:commit
npm run test:docs
EXPO_PUBLIC_E2E_MODE=1 EXPO_APP_VARIANT=development npm run build:web:ci
E2E_SKIP_BUILD=1 npx playwright test
```

Full 185-flow suite required at this checkpoint.

## Acceptance

- [x] One writer per persisted key; no duplicate storage paths.
- [x] Cold start paints from Query + store hydration; credentials remain secure.
- [x] No `loadTs`/`hookRuntime`; test discovery and typecheck still cover every
  suite.
- [x] `fast-check` covers the reducers/merges named above.
- [x] `knip` is clean or has a reviewed, small ignore list.
- [x] Full E2E passes, including reload, onboarding and credential rotation.

## Pitfalls

- Query persistence must never include inline message media; the legacy
  transcript reader still handles records created by earlier releases.
- Zustand `persist` writes on every change unless throttled/partialized; keep the
  existing per-key ordering guarantees.
- Migration must preserve existing users: schema versions, malformed entries and
  secure-store transitions.
- Removing `loadTs` can silently drop dynamic imports; compare executed test
  identities, not only file counts.
