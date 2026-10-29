# Task Recipes

Short, opinionated paths for the changes agents make most often. Each recipe
lists only what to read, what to edit, and how to validate. The linked docs
remain authoritative; this page is the checklist.

Back to the [engineering index](README.md) · [documentation hub](../README.md).

## Translations

**When:** you add or change a user-facing string.

**Read only:** [design system § Accessibility, localization and feature acceptance](../design/design-system.md#accessibility-localization-and-feature-acceptance) and `lib/i18n/languages.ts`.

**Edit:**

1. Add the key to `lib/i18n/locales/en/<namespace>.json`.
2. Add the same key to every locale folder in `lib/i18n/locales/<code>/<namespace>.json`.
   Preserve `{{interpolation}}` names and the plural suffixes the locale requires.
3. Add a new language to `SUPPORTED_LANGUAGES` in `lib/i18n/languages.ts` and to
   `supportedLocales` in `app.config.ts`.
4. Run `npm run gen:i18n` to regenerate `lib/i18n/resources.ts`.

**Validate:**

```bash
npm run gen:i18n
npx vitest run tests/vitest/i18n.test.ts
```

Use `npm run test:i18n:loose` only while iterating. Strict parity is required
before the change is complete.

**Done:** every supported locale has the key, placeholders match, plural
categories match, and the generated registry is committed.

**Pitfalls:** English-only keys, renamed placeholders, missing plural suffixes,
and editing `resources.ts` by hand.

## Settings section or row

**When:** you add a settings section, row, toggle, or search target.

**Read only:** [design system § Settings organization and search](../design/design-system.md#settings-organization-and-search), [component inventory § Settings](../design/components/settings.md#settings-components), and [Storybook § Adding a story](../design/storybook.md#adding-a-story) when the control is reusable.

**Edit:**

1. Add or extend the section in `components/settings/sections/`.
2. Register it in `components/settings/settings-section-registry.tsx`; add
   search keywords/targets through the registry or `settings-search.ts`.
3. Reuse `components/settings/sections/setting-rows.tsx`; use `usePalette()` and
   design tokens, never literal colors.
4. Persist a preference through `providers/opencode-preferences.ts` or
   `providers/persisted-preferences.ts`; do not keep domain state in the component.
5. Add the strings to every locale (see [Translations](#translations)).
6. Add a Storybook story for a reusable control.
7. Extend `tests/e2e/settings.spec.mjs` when the flow changes.

**Validate:**

```bash
npm run build:storybook
npx playwright test tests/e2e/settings.spec.mjs
npm run test:ci:static
```

**Done:** the section is searchable, the preference survives relaunch, the
control has a story if reusable, and the settings flow passes.

**Pitfalls:** local copies of provider state, search indexing current values or
credentials, and one-off controls that duplicate `setting-rows.tsx`.

## Fake-server scenario and E2E flow

**When:** the client contract changes, or you need a deterministic server state
for a flow.

**Read only:** [fake server](validation/fake-server.md) and
[E2E flow coverage](validation/e2e.md).

**Edit:**

1. Add or extend the state in `tests/fake-opencode/state.mjs`.
2. Add canonical data in `tests/fake-opencode/fixtures.mjs`.
3. Implement the route or event in `tests/fake-opencode/server.mjs`.
4. Add the contract assertion to `tests/fake-opencode/self-test.mjs`.
5. Add a `resetScenario` case in `tests/e2e/helpers/flows.mjs` if the scenario
   needs an explicit reset.
6. Cover the flow in `tests/e2e/<domain>.spec.mjs`.

**Validate:**

```bash
npm run test:fake-server:self
npx playwright test tests/e2e/<domain>.spec.mjs
npm run test:e2e:web   # before push
```

**Human validation:** any change under `tests/e2e/` or `tests/fake-opencode/`
requires explicit human validation, even when the automated checks pass.

**Done:** the scenario is deterministic, V1/V2 behavior stays aligned where the
feature is in the supported intersection, and the flow fails without the change.

**Pitfalls:** weakening an existing scenario, relying on wall-clock timing,
sharing fixed ports across concurrent runs, and testing only the happy path.

## Provider state field or endpoint

**When:** you add or change provider-owned state, a session field, or an API
endpoint consumed by the app.

**Read only:** [state and data § State Ownership Overview](../architecture/state-and-data.md#state-ownership-overview) and the owning domain section; [architecture § Module Map](../architecture/overview.md#module-map); [API contract](../architecture/api-contract.md) for endpoint changes.

**Edit in this order:**

1. Public type: `providers/opencode-provider-types.ts`.
2. Value assembly: `providers/opencode-provider-values.ts`.
3. Domain wiring: `providers/use-opencode-provider-composition.ts` and the
   owning domain hook.
4. Persistence: `providers/use-opencode-persistence.ts` and
   `providers/persistence-hydration.ts` only if the field survives relaunch.
5. Context exposure: `providers/opencode-contexts.ts` and the domain context type.
6. Derived data: `providers/opencode-provider-selectors.ts`; never duplicate
   provider-derived state in a component.
7. Fake server: `tests/fake-opencode/` for the new endpoint or field.
8. Tests: targeted Vitest, then E2E if the user flow changed.

**Validate:**

```bash
npx vitest run tests/vitest/provider-runtime.test.ts tests/vitest/persistence-hydration.test.ts
npm run test:fake-server:self
npx playwright test tests/e2e/<domain>.spec.mjs
```

**Done:** the field has one owner, hydration is covered if persisted, the
context surface stays within the architecture ratchet, and the fake server
matches the client contract.

**Pitfalls:** adding a second source of truth, widening the context past the
ratchet, fetching from a component, adding a V1 fallback, and changing a
persisted key without a hydration test.
