# AGENTS.md

Read [docs/README.md](docs/README.md) first. It is the task router and
documentation hub. Read the owning feature's `AGENTS.md` and only the relevant
implementation docs. Do not preload the documentation tree or invent another
architecture.

## Implementation ownership

- `app/`: thin Expo Router entrypoints. `features/`: product presentation,
  domain state/actions, services, rules and tests. `runtime/`: cross-feature
  state and lifecycle composition. `shared/`: feature-independent controls,
  contracts, protocol, platform, storage, query infrastructure, i18n and
  utilities. `modules/`: native Expo modules.
- One application owner, one connection owner, and retained connection/project
  branches preserve continuity. Keep the single connectivity/query owners,
  connection-wide catalogs/streams, credential-generation guards and stable
  presentation map.
- Keep domain state out of routes and presentation. Settings and Onboarding may
  compose public UI from other features; ownership does not transfer. Use named
  `index.ts`, `context.ts` or `runtime.ts` exports across features. No private
  cross-feature imports, wildcard exports, cycles, parallel component copies or
  compatibility shims. `config/architecture.json` is the enforced edge/export
  policy.
- Presentation never fetches, persists credentials, normalizes raw payloads or
  invokes arbitrary native SDKs. Shared UI receives behavior through props and
  does not import features or runtime.
- Protocol normalization belongs in `shared/protocol/`. New API-dependent
  features are V2-only; never add a new V1 adapter or fallback.
- Server facts belong to TanStack Query; device facts belong to the app store in
  `runtime/core` ([ADR 0051](docs/adr/0051-app-core-state-tiers.md)). Do not
  mirror Query responses into another store. No second store, DI container,
  Redux or XState. Preserve SSE plus polling, foreground/demand gates and the
  separation between inspection, terminal and chat focus.
- Native changes follow [native module guidance](modules/AGENTS.md) and
  [ADR 0016](docs/adr/0016-supported-expo-native-integrations.md). Keep Expo MCP
  optional and out of normal CI; do not vendor generic skills or update unrelated
  dependencies during SDK migrations.

## Start here

| Task touches | Read before editing | Validate with |
| --- | --- | --- |
| Copy/translations | [Translations recipe](docs/engineering/task-recipes.md#translations) | `npm run gen:i18n`, strict i18n test |
| Settings or reusable UI | [Settings recipe](docs/engineering/task-recipes.md#settings-section-or-row), [design system](docs/design/design-system.md), [Storybook](docs/design/storybook.md) | Storybook and affected E2E |
| Chat/transcript | [Chat inventory](docs/design/components/chat.md), [Chat behavior](docs/product/functional-spec.md#chat-screen-detailed-behavior) | Chat/diffs E2E |
| Domain state, session or persistence | [State and data](docs/architecture/state-and-data.md#state-ownership-overview), [runtime guidance](runtime/AGENTS.md) | owning Vitest and full E2E |
| Protocol, endpoints or events | [API contract](docs/architecture/api-contract.md), [ADR 0003](docs/adr/0003-v2-first-protocol-boundary.md), [fake server](docs/engineering/validation/fake-server.md) | contract Vitest, fake-server self-test, full E2E |
| SSE, polling, offline or slow networks | [Network resilience](docs/architecture/network-resilience.md) | runtime Vitest and realtime/network E2E |
| Logs, traces, metrics or telemetry | [Observability](docs/architecture/observability.md), [ADR 0020](docs/adr/0020-local-first-observability-and-otlp.md) | shared observability Vitest, settings/realtime E2E |
| Native, platform, build or release | [Development](docs/engineering/development.md), [Integrations](docs/engineering/integrations-and-operations.md) | CI release build; native checks when available |
| Tests or fake server | [Validation index](docs/engineering/testing-and-validation.md), [strategy](docs/engineering/validation/strategy.md#test-selection-matrix) | cheapest sufficient level; full E2E on release tag |
| Docs or ADR | [Docs hub](docs/README.md), [ADR process](docs/adr/README.md) | `npm run test:docs` and static |
| Release version | [Development](docs/engineering/development.md), [ADR 0018](docs/adr/0018-tag-driven-release-pipeline.md) | push version tag |

## Ratchets and UI foundation

- Provider entrypoint at most 60 lines; production source files at most 500.
  Combined domain-context surface at or below 127 members. Do not raise limits.
- Preserve keyboard avoidance, tab layout, native modal hosts, workspace scope,
  keyboard/Back behavior, localization, text scaling and specialized renderers.
- Read [ADR 0013](docs/adr/0013-source-owned-ui-and-complex-forms.md) before UI
  foundation changes. Use `shared/ui/`, CVA and `cn()`. Author tokens only in
  `shared/ui/theme/ui-tokens.json`; run `npm run gen:ui-tokens` and check mode.
- Complex forms use existing React Hook Form/Zod validators; simple preferences
  stay immediate. Registry upgrades are reviewed source diffs with provenance.
- Reusable presentation changes need a colocated Storybook story and
  `npm run build:storybook`; orchestration/full screens belong in E2E.

## Architecture Decision Records

Follow [the ADR process](docs/adr/README.md): copy the numbered template, update
the index and link the decision from its implementation doc. Supersede accepted
ADRs without rewriting their reasoning.

## Development loop

1. Find the owner through the router; extend existing code.
2. Make the smallest complete change, preserving error handling and trust
   validation.
3. Update behavior coverage at the cheapest sufficient level; explain
   behavior-preserving moves in the PR.
4. Update user-facing strings in every locale, run `npm run gen:i18n` and strict
   parity, and update current docs and section README links.
5. Record durable decisions with an ADR; never rewrite an accepted one.
6. Run the commit gate, push to `main` or update the PR branch, and inspect
   GitHub Actions. CI is the final integration authority.

## Commit gate

Every commit, including docs-only and follow-up fixes, must pass before it is
created or amended:

1. Run `npm run validate:commit`.
2. Run the owning focused checks from the table above and the
   [test-selection matrix](docs/engineering/validation/strategy.md#test-selection-matrix).
   Protocol/fake-server changes also run `npm run test:fake-server:self`; UI
   flow changes run the affected Playwright spec; localization changes run
   `npm run gen:i18n` and the strict i18n test.
3. If a required command fails or the toolchain cannot run it, do not commit.
   Fix the toolchain or ask for help. CI is not a substitute.
4. Never commit to see what CI says, and never amend to hide a failed gate.
5. Report the exact commands and outcomes. State any check that could not run
   and why. "I could not run the tests" blocks the commit.

## Validation

Baseline for touched code: `npm run validate:commit`. Feature tests are
colocated; `tests/vitest/test-discovery.test.ts` prevents suites disappearing.
Do not increase the test-typecheck exclusion budget.

`ci.yml` runs static checks, architecture, fake-server validation, Storybook,
FOSS preparation and critical Playwright smoke flows. `release.yml` runs the full
browser E2E suite and native release builds once on a `v*` tag. Use the
[test-selection matrix](docs/engineering/validation/strategy.md#test-selection-matrix);
the full suite is not a per-push requirement.

A red CI run blocks merge. Harden flaky failures instead of adding retries.
Native/Android-risk changes may use `npm run build:development:android` when an
SDK is available; Play internal testing and TestFlight are the real-device
validation environments.

Any edit under `tests/e2e/` or `tests/fake-opencode/` requires explicit human
validation even when automation passes. Do not add E2E specs when existing
owners suffice; update the budget in the same change.

For iteration use `validate:fast`, `test:e2e:smoke` or `test:e2e:last-failed`.
Concurrent runs use `test:e2e:web:isolated`; preserve per-worker isolation.

## Release

Android release artifacts are `arm64-v8a` only; 32-bit-only devices are
unsupported. Do not add another release ABI.

For every version increase, update `version`, `android.versionCode` and
`ios.buildNumber` in `app.config.ts`, update `package.json`, add the Play
changelog, commit to `main`, then push the `v<version>` tag. GitHub Actions
validates, signs and publishes; do not run manual release scripts. Never move or
delete a release tag; fix forward with a new version. See
[Development](docs/engineering/development.md) and
[ADR 0018](docs/adr/0018-tag-driven-release-pipeline.md).

Make every source edit here, sync before checking, and treat a temporary mirror
as read-only. Run generators here. Exclude AppleDouble `._*` files from mirrors.

A change is done when ownership, behavior, localization, docs/ADRs, stories,
validation and required human checks are satisfied. The final summary states
what changed, what passed and any remaining risk.
