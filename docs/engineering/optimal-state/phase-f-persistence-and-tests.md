# Phase F — Persistence and Tests

Status: **in progress**. Query persistence, the session-cache removal, and
Zustand device preference persistence are complete. The first native-import
batch and four fast-check properties landed. The remaining legacy tests and
Knip cleanup are open.

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

## Remaining work

### `loadTs` and `hookRuntime` removal

The baseline had 87 legacy suites using `tests/helpers/runtime.mjs`. Migrate
them in feature batches:
1. Add the renderer and platform mocks the suite needs.
2. Replace `loadTs` with native imports.
3. Replace `vi.mock` only at platform boundaries; do not mock domain modules.
4. Keep the same test names and assertions. Compare test identities before and
   after each batch.
5. Delete the suite’s import map and any dead stand-ins.
6. Delete `loadTs`/`hookRuntime` when the last suite is migrated.

Do not add new `loadTs` usage. Do not weaken a suite to make migration easier.

### Property tests and dead-code cleanup

- `tests/vitest/state-properties.test.ts` covers the connection reducer, retry
  status merge, anchored transcript page merge and live overlay ordering.
- Add `knip` with a focused config; remove unused files/exports/dependencies
  reported by a clean run.
- Keep generated locale resources exempt.

## Phase F gate

```bash
npm run validate:commit
npm run test:docs
EXPO_PUBLIC_E2E_MODE=1 EXPO_APP_VARIANT=development npm run build:web:ci
E2E_SKIP_BUILD=1 npx playwright test
```

Full 185-flow suite required at this checkpoint.

## Acceptance

- One writer per persisted key; no duplicate storage paths.
- Cold start paints from Query + store hydration; credentials remain secure.
- No `loadTs`/`hookRuntime`; test discovery and typecheck still cover every
  suite.
- `fast-check` covers the reducers/merges named above.
- `knip` is clean or has a reviewed, small ignore list.
- Full E2E passes, including reload, onboarding and credential rotation.

## Pitfalls

- Query persistence must never include inline message media; the legacy
  transcript reader still handles records created by earlier releases.
- Zustand `persist` writes on every change unless throttled/partialized; keep the
  existing per-key ordering guarantees.
- Migration must preserve existing users: schema versions, malformed entries and
  secure-store transitions.
- Removing `loadTs` can silently drop dynamic imports; compare executed test
  identities, not only file counts.
