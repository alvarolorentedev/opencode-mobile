# AGENTS.md

Read [docs/README.md](docs/README.md) first. It is the task router. Read the
owning feature's `AGENTS.md` and only the relevant implementation documentation.
Do not preload the documentation tree or invent another architecture.

## Implementation ownership

- `app/`: thin Expo Router entrypoints, route/layout declarations and metadata.
- `features/`: product presentation, domain state/actions, services, rules and tests.
- `runtime/`: cross-feature state and lifecycle composition. One application owner,
  one connection owner, and retained connection/project branches preserve continuity.
- `shared/`: feature-independent controls, contracts, protocol, platform, storage,
  query infrastructure, i18n and utilities.
- `modules/`: native Expo modules; preserve discovery and registered module names.
- `tests/e2e/` and `tests/fake-opencode/`: the behavioral contract, with central harnesses.

See [feature boundaries](docs/architecture/feature-boundaries.md) for ownership,
public APIs and the strictly limited shared UI/runtime exception.

## Start here

| Task touches | Read before editing | Validate with |
| --- | --- | --- |
| Copy/translations | [Translations recipe](docs/engineering/task-recipes.md#translations) | `npm run gen:i18n`, strict i18n test |
| Settings or reusable UI | [Settings recipe](docs/engineering/task-recipes.md#settings-section-or-row), [design system](docs/design/design-system.md), owning component inventory | Storybook and affected E2E |
| Chat/transcript | [Chat inventory](docs/design/components/chat.md#chat-components), [Chat behavior](docs/product/functional-spec.md#chat-screen-detailed-behavior) | Chat/diffs E2E |
| Domain state/session/persistence | [State and data](docs/architecture/state-and-data.md#state-ownership-overview), [runtime guidance](runtime/AGENTS.md) | Owning Vitest and full E2E |
| Protocol/endpoints/events | [API contract](docs/architecture/api-contract.md), [ADR 0003](docs/adr/0003-v2-first-protocol-boundary.md), [fake server](docs/engineering/validation/fake-server.md) | Contract Vitest, fake-server self-test and full E2E |
| SSE/polling/offline | [Network resilience](docs/architecture/network-resilience.md) | Runtime Vitest and realtime/network E2E |
| Logs/traces/metrics/diagnostics/remote telemetry | [Observability](docs/architecture/observability.md), [ADR 0020](docs/adr/0020-local-first-observability-and-otlp.md) | `shared/observability` Vitest, settings/realtime network E2E, FOSS self-test |
| Native/platform/config | [Development](docs/engineering/development.md), [integrations](docs/engineering/integrations-and-operations.md) | CI release build; local native checks when the environment supports them |
| Tests/fake server | [Validation index](docs/engineering/testing-and-validation.md), [strategy](docs/engineering/validation/strategy.md) | Cheapest sufficient level; full E2E runs on the release tag |
| Docs/ADR | [Docs router](docs/README.md), [ADR process](docs/adr/README.md) | `npm run test:docs` and static |
| Release | [Development](docs/engineering/development.md), [ADR 0018](docs/adr/0018-tag-driven-release-pipeline.md), [integrations](docs/engineering/integrations-and-operations.md), [updates](docs/product/app-updates.md)/[F-Droid](docs/engineering/fdroid.md) | Push a version tag; GitHub Actions validates, builds and distributes |

## Boundary rules

Keep domain state out of routes and presentation. Settings and Onboarding may
compose public UI from other features; that does not transfer state ownership.

Use a feature's named `index.ts`, `context.ts` or `runtime.ts` exports across
features. Inside a feature, import its implementation directly. Do not add private
cross-feature imports, wildcard public exports, cycles, parallel component copies
or compatibility shims. `config/architecture.json` is the enforced edge/export
policy; keep its changes deliberate and documented.

Presentation never fetches, persists credentials, normalizes raw server payloads,
or directly invokes arbitrary native SDKs. Reuse domain actions, pure contracts
and the shared platform interfaces. Shared UI remains feature-independent. Only
the exact existing controls listed in the architecture documentation may import
specified symbols from `runtime/ui.ts`; no new bridge context or duplicated state.

Protocol normalization belongs in `shared/protocol/`. Existing V1 imports and
compatibility branching stay in the compatibility/contract boundary. New
API-dependent features are V2-only; never add a new V1 adapter or fallback.

Preserve the single connectivity/query owners, connection-wide catalogs/streams,
credential-generation guards, retained workspace state and stable presentation map.
Do not mirror Query responses into another state store. Preserve SSE plus polling,
foreground/demand gates and the separation between inspection, terminal and chat focus.

Native changes also follow [native module guidance](modules/AGENTS.md) and
[ADR 0016](docs/adr/0016-supported-expo-native-integrations.md). Keep Expo MCP
optional and out of normal CI; do not vendor generic skills or update unrelated
dependencies during SDK migrations.

## Ratchets and UI foundation

- The provider entrypoint stays at most 60 lines; production source files at most 500.
- Combined domain-context surface stays at or below 127 members. Do not raise limits.
- Fix layering failures by moving code to its owner, not by adding broad exceptions.
- Preserve keyboard avoidance, tab layout, native modal hosts, workspace scope,
  keyboard/Back behavior, localization, text scaling and specialized renderers.
- Read [ADR 0013](docs/adr/0013-source-owned-ui-and-complex-forms.md) before UI
  foundation changes. Use the source-owned controls in `shared/ui/`, CVA and `cn()`.
- Author tokens only in `shared/ui/theme/ui-tokens.json`; run `npm run gen:ui-tokens`
  and check mode. No new styling engine, Paper wrappers or generic form framework.
- Complex forms use existing React Hook Form/Zod validators. Simple preferences
  remain immediate. Registry upgrades are reviewed source diffs with provenance.
- Reusable presentation changes need a colocated production-component Storybook
  story and `npm run build:storybook`; see [Storybook](docs/design/storybook.md); orchestration/full screens belong in E2E.

## Architecture Decision Records

Follow [the ADR process](docs/adr/README.md): copy the numbered template, update the index and link the decision from its implementation document. Supersede accepted ADRs without rewriting their reasoning.

## Development loop

1. Find the owner through the router and scoped guidance; extend existing code.
2. Make the smallest complete change, preserving error handling and trust validation.
3. Update behavior coverage at the cheapest sufficient level. Existing coverage is
   sufficient for behavior-preserving moves; explain that in the PR.
4. Add every new/changed user-facing string to every supported locale under
   `shared/i18n/locales/`, retaining placeholders/plurals. Run `npm run gen:i18n`
   and strict parity checks. English runtime fallback is not completion.
5. Update current implementation docs and section README links in the same change.
6. Record durable decisions with an ADR; supersede accepted decisions, never rewrite them.
7. Run the commit gate below, then push to `main` or update the PR branch, and
   inspect GitHub Actions. Fix failures there. CI is the final integration authority;
   it is not the first validator.

## Commit gate

Every commit, including documentation-only and follow-up fix commits, must pass
the local commit gate before it is created or amended:

1. Run `npm run validate:commit`.
2. Run the owning focused checks from the task router and
   [test-selection matrix](docs/engineering/validation/strategy.md#test-selection-matrix).
   Protocol/fake-server changes also run `npm run test:fake-server:self`; UI flow
   changes run the affected Playwright spec; localization changes run
   `npm run gen:i18n` and the strict i18n test.
3. If a required command fails, or the toolchain cannot run it (wrong Node
   version, missing package manager, missing browser), do not commit. Fix the
   toolchain or ask for help. CI is not a substitute for a local check.
4. Never commit "to see what CI says" after a preventable local failure. Do not
   amend a commit to hide a failed gate; fix the failure and rerun the gate.
5. Report the exact commands and outcomes in the final summary. State any check
   that could not run and why. "I could not run the tests" blocks the commit.

## Validation

Baseline for touched code: `npm run validate:commit`. Feature tests are
colocated; `tests/vitest/test-discovery.test.ts` prevents suites silently disappearing
from Vitest or TypeScript. Do not increase the test-typecheck exclusion budget.

`ci.yml` runs static checks, Vitest/architecture, fake-server validation, Storybook,
FOSS preparation and critical Playwright smoke flows on every push to `main` and every
PR. `release.yml` runs the full browser E2E suite and native release builds once on a
`v*` tag. `android-cache.yml` rebuilds the Android release tasks twice a week so
`release.yml` can restore a warm Gradle build cache; it publishes nothing. Use the
[test-selection matrix](docs/engineering/validation/strategy.md#test-selection-matrix)
to choose focused local checks; the full suite is not a per-push requirement.

A red CI run blocks merge. Confirm and harden flaky failures instead of adding retries.
Native/Android-risk changes may be checked locally with `npm run build:development:android`
when an SDK is available, but the tag release is the authoritative native build. Play
internal testing and TestFlight are the real-device validation environments. Static
release verification cannot guarantee successful device startup.

Any edit under `tests/e2e/` or `tests/fake-opencode/` requires explicit human validation
even when automation passes. Do not add E2E specs when existing owning specs or
lower-level tests suffice; update the budget in the same change when intentionally
adding browser coverage.

For iteration, use `validate:fast`, `test:e2e:smoke` or `test:e2e:last-failed`.
Concurrent runs use `test:e2e:web:isolated`; preserve per-worker backend isolation.

## Release

Android release artifacts are `arm64-v8a` only; 32-bit-only Android devices are
unsupported. Do not add `armeabi-v7a`, `x86` or `x86_64` to a release build.

For every release version increase:

1. Update `version`, `android.versionCode` and `ios.buildNumber` in `app.config.ts`.
2. Update the matching `package.json` version.
3. Add `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`.
4. Commit to `main`, then create and push the `v<version>` tag.

GitHub Actions performs validation, signing, Google Play internal upload, TestFlight upload
and GitHub Release publication. Do not run manual packaging, signing, upload or release
scripts. Never move or delete a release tag; fix forward with a new version. A failed
release validation is not a reason to move the tag: bump the version, commit the fix,
and tag the new commit.

A local temporary mirror may run heavy checks. Make every source edit here, sync
before checking, treat mirror output as read-only, and never commit/tag/push there.
Run generators that update committed files here. Exclude AppleDouble `._*` metadata
from mirrors; preserve nested native/fastlane Android directories.

For every release version increase, add concise release notes in
`fastlane/metadata/android/en-US/changelogs/<android.versionCode>.txt` matching
`app.config.ts`, and include the changelog in the release commit.

A change is done when ownership, behavior, localization, docs/ADRs, stories,
validation and required human checks are satisfied. The final summary states what
changed, what passed and any remaining risk.
