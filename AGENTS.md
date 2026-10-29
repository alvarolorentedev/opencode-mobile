# AGENTS.md

Follow the current implementation docs in `docs/`. Do not invent a new architecture.

Read first:

1. `docs/README.md` (task router and section map)
2. `docs/architecture/overview.md`
3. `docs/architecture/state-and-data.md`
4. `docs/design/component-inventory.md`
5. `docs/engineering/testing-and-validation.md`

## Documentation Map

- `docs/architecture/` — runtime composition, state ownership, protocol, realtime
- `docs/product/` — user-visible behavior and feature parity
- `docs/design/` — design system, components, Storybook, UX proposals, design QA
- `docs/engineering/` — setup, validation, operations, release, deferred work
- `docs/adr/` — architecture decisions and the decision workflow

Each section has a `README.md` with an index and ownership map. Put a new doc in
the narrowest section that owns the concern. Update the section README in the
same change.

## Architecture Decision Records

Decisions are part of the normal workflow, not an afterthought.

Write an ADR when a change:

- selects a framework, transport, storage model, or protocol boundary
- changes ownership between `app/`, `components/`, `providers/`, `lib/`, or
  `providers/services/`
- adds or removes a compatibility path or supported platform
- establishes a design-system primitive, token family, or accessibility policy
- rejects a viable alternative for a reason future maintainers need to know
- changes the documentation or decision workflow itself

Process:

1. Read `docs/adr/README.md`.
2. Copy `docs/adr/template.md` to `docs/adr/NNNN-short-kebab-title.md`.
3. Add the ADR to the index in `docs/adr/README.md`.
4. Link it from the affected implementation doc and the change summary.
5. Supersede, never rewrite, an accepted ADR.

`tests/vitest/docs.test.ts` enforces ADR numbering, required sections, index
coverage, and documentation links.

## Architecture Rule

This app is provider-centric.

- `providers/opencode-provider.tsx` owns domain state and orchestration.
- `app/` owns routing and thin screen wiring.
- `components/` owns presentation and local UI state.
- `providers/services/` owns provider-facing API aggregation.
- `lib/` owns protocol, formatting, storage keys, notifications, and voice helpers.
- `tests/fake-opencode/` and `tests/e2e/` define the behavioral contract.

Do not move domain behavior into screens or presentational components.

- New features that require API compatibility are V2-only for now; see
  `docs/architecture/api-contract.md`. Do not add new V1 adapters or fallbacks.

## Placement Rules

### `app/`

Put:

- route entrypoints
- tab/layout wiring
- thin screen controllers
- calls into `useOpencode()`

Do not put:

- fetch logic
- session orchestration
- capability reconciliation
- protocol shaping

### `components/`

Put:

- rendering
- local UI state
- chat/settings UI composition
- surface-specific helpers

Do not put:

- API calls
- persistence
- shared domain state
- cross-session caches

### `providers/`

Put:

- connection flow
- project/session state
- refresh logic
- permission/question handling
- capability reconciliation
- conversation mode state machine
- SSE and polling fallback
- persistence hydration and write-back

Shared behavior across tabs belongs here.

### `providers/services/`

Put:

- session fetch helpers
- capability/config/provider discovery helpers

Services aggregate requests. They do not own app state.

### `lib/opencode/`

Put:

- client construction
- endpoint wrappers
- protocol types
- message formatting
- transcript transformation

Raw server-shape handling belongs here, not in UI code.

### `lib/`

Put:

- notifications
- speech input/output
- storage keys
- platform integration helpers

Platform side effects should start here or from the root shell, not from arbitrary components.

### `tests/fake-opencode/`

Put:

- deterministic server scenarios
- endpoint fixtures
- SSE behavior
- permission/question blocking logic

If the client contract changes, update the fake server.
Changes here require explicit human validation.

### `tests/e2e/`

Put:

- boot flow coverage
- prompt lifecycle coverage
- blocking interaction flows
- provider setup flows
- SSE fallback coverage

Prefer flow coverage over low-value unit tests for orchestration changes.
Changes here require explicit human validation.

## Practices

- Keep screens thin.
- Keep presentational components dumb except for local UI state.
- Put code in the narrowest correct layer.
- Extend existing helpers, selectors, and services before adding abstractions.
- Keep protocol normalization close to `lib/opencode/`.
- Keep persistence logic close to `providers/use-opencode-persistence.ts`.
- Preserve continuity across tabs.
- Respect the dual realtime model: SSE plus polling fallback.
- Prefer deterministic state transitions over clever indirection.
- Reuse design tokens and shared controls; do not add literal colors or
  one-off primitives.
- Add or update a Storybook story for reusable presentation components.
- Add every new or changed user-facing string to every supported locale in
  `lib/i18n/locales/<code>/`, preserving interpolation placeholders and plural
  categories.

## Avoid

- fetch logic in components
- formatting or protocol parsing in screens
- new shared state stores outside the provider
- duplicated provider-derived state in local UI state
- protocol changes hidden in UI code
- shipping user-facing copy that only exists in English
- parallel component copies instead of extending the shared design system
- provider-orchestration stories in Storybook
- unrelated refactors

## Change Mapping

### Chat

- visuals, composer presentation, pagination, local interaction state: `components/chat/`
- transcript shaping and activity derivation: `lib/opencode/` or provider selectors
- prompt lifecycle, abort, pending interactions, refresh behavior: `providers/`

### Project

- screen wiring and list presentation: `app/(tabs)/projects.tsx`
- project/session continuity rules: `providers/`
- project/session fetch logic: `providers/services/session-service.ts`

### Settings

- section and dialog UI: `components/settings/`
- persisted preferences and reconciliation: `providers/`
- provider auth and capability requests: `providers/services/capabilities-service.ts` and `lib/opencode/client.ts`
- extensions (MCP/plugin/skill/command config): `providers/use-extensions-state.ts`, `providers/services/extensions-service.ts`, and `lib/opencode/extensions/`
- platform deep links and native integration: `lib/`

### Design system and Storybook

- tokens, palettes, theme mapping: `constants/theme.ts`, `constants/appearance.ts`, `constants/paper-theme.ts`, `constants/design-tokens.ts`
- shared settings controls: `components/settings/sections/setting-rows.tsx`
- component responsibilities: `docs/design/component-inventory.md`
- design rules and acceptance: `docs/design/design-system.md`
- Storybook config: `.storybook/`
- stories: co-located `components/**/*.stories.tsx`

Add a story when introducing or changing a reusable primitive or shared
control. Stories render the production component with the real appearance and
Paper providers. Do not add provider-orchestration or full-screen stories to
Storybook; cover those with E2E flows. Run `npm run build:storybook` when
changing stories or Storybook config. See `docs/design/storybook.md`.

### User-facing copy and translations

- source strings: `lib/i18n/locales/en/<namespace>.json`
- translated strings: `lib/i18n/locales/<language>/<namespace>.json` for every
  entry in `SUPPORTED_LANGUAGES`
- registry: `lib/i18n/resources.ts` (generated; run `npm run gen:i18n`)
- contract test: `tests/vitest/i18n.test.ts`

A feature is not complete while any new or changed string is missing from a
supported locale or relies on runtime English fallback.

### Protocol

Update together when needed:

- `lib/opencode/client.ts`
- `lib/opencode/types.ts`
- `lib/opencode/format.ts`
- matching fake-server handlers in `tests/fake-opencode/`

### Conversation mode, voice, notifications

- orchestration and state machine: `providers/`
- native wrappers: `lib/voice/` and `lib/notifications.ts`
- UI affordances: `components/chat/`

### Inbound sharing

- staging and lifecycle: `providers/use-share-state.ts`
- payload normalization and limits: `lib/share/parse.ts`
- routing and preview: `app/+native-intent.ts` and `app/share.tsx`
- receive plugin config and platform gaps: `app.config.ts` and
  `docs/product/parity/ios-share.md`

## Development Loop

For each task:

1. Read the relevant docs and implementation.
2. Identify the correct layer.
3. Make the smallest change that preserves documented behavior.
4. Add or update tests when the behavior contract changes.
5. Add or update every new or changed user-facing string in all supported
   locales, then run `npm run gen:i18n` and the i18n test.
6. Update docs when architecture, behavior, or contracts change.
7. Record any durable decision in `docs/adr/` and update its index.
8. Add or update a Storybook story when reusable presentation changes.
9. Run validation proportional to risk.

## Validation

Baseline:

```bash
npm run lint
npm run typecheck
```

Run when relevant:

- fake backend or protocol changes:
  - `npm run test:fake-server:self`
- provider, session, blocking flow, SSE, polling, or user-flow changes:
  - `npm run test:e2e:web`
- Storybook stories or config:
  - `npm run build:storybook`
- native or Android-risk changes:
  - `npm run build:development:android`

### Before Push

CI runs the `validate` job. It must be green, so run the same checks locally and do not push until they pass:

```bash
npm run test:ci:static
npm run test:fake-server:self
npm run build:storybook
npm run test:e2e:web
```

A red e2e run is blocking. If a failure looks intermittent, rerun the failing test to confirm and harden it before pushing rather than pushing over a flaky check.

### Fast iteration

CI runs Playwright in one job with four workers; each worker has its own fake
V1/V2 pair, so the per-worker global scenario stays isolated. For iteration:

```bash
npm run test:ci:static          # cached; ~15s when warm, ~45s cold
npm run test:e2e:smoke          # 17 critical flows
npm run test:e2e:last-failed
npm run test:e2e:web:isolated -- tests/e2e/chat.spec.mjs
```

After one `npm run build:web:e2e`, keep `npm run serve:web:prebuilt` running in
another terminal so Playwright reuses the export instead of rebuilding it.
Concurrent runs should use `test:e2e:web:isolated` (fresh port block) rather
than the shared defaults. Override the worker count with `E2E_WORKERS`; it
defaults to 2 locally and 4 in CI. The smoke set and targeted specs are for
iteration; the full `test:e2e:web` gate above is still required before
push/release. New coverage that does not need the browser belongs in Vitest.

### Local mirror for heavy checks

The project root may live on an external or network drive. To speed up lint,
typecheck, the `test:*` suites, and native builds, you may copy the working tree
to a local temporary directory on this machine (for example under
`/private/var/folders/...` or `$TMPDIR`).

The project root on the (possibly remote) drive remains the single source of
truth:

- make every source edit in the project root, never in the mirror
- sync the working tree (or at least the changed files) into the mirror before
  running a check, and treat mirror output as read-only evidence
- never commit, tag, or push from the mirror
- when a check regenerates a committed file (for example `npm run gen:i18n`),
  run the generator in the project root and commit the root copy, not the
  mirror's

For every release version increase, add or update
`fastlane/metadata/android/en-US/changelogs/<android.versionCode>.txt` with
concise user-facing release notes. The filename must match `android.versionCode`
in `app.config.ts`, and the changelog must be included in the release commit.

## Tests

This repo validates behavior mainly with static checks and end-to-end flows.

Add or update tests when changing:

- hydration or connect flow
- project discovery or session bootstrap
- prompt submission lifecycle
- permission or question flows
- provider/model/agent capability discovery
- SSE or polling fallback behavior
- fake server contract behavior

Any change to `tests/e2e/` or `tests/fake-opencode/` requires explicit human validation, even if automated checks pass.

## Definition Of Done

A change is done when:

- code is in the correct layer
- behavior is preserved or intentionally updated
- tests are added or updated for changed behavior
- every new or changed user-facing string is present in all supported locales
  with matching interpolation placeholders and plural categories, and the i18n
  parity test passes; runtime English fallback in a shipped locale means the
  feature is not complete
- any `tests/e2e/` or `tests/fake-opencode/` changes have explicit human validation
- documentation in `docs/` is updated when behavior, architecture, or contracts changed
- any durable decision has an ADR in `docs/adr/` and an index entry
- reusable presentation changes have a Storybook story and `npm run build:storybook` passes
- the pre-push CI-equivalent checks pass (`test:ci:static`, `test:fake-server:self`, `build:storybook`, `test:e2e:web`)
- validation matches the risk of the change
- the final summary states what changed, what was verified, and any remaining risk
