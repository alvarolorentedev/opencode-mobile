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
| Native/platform/config | [Development](docs/engineering/development.md), [integrations](docs/engineering/integrations-and-operations.md) | Android build and relevant native/device checks |
| Tests/fake server | [Validation index](docs/engineering/testing-and-validation.md), [strategy](docs/engineering/validation/strategy.md) | Cheapest sufficient level; full when required |
| Docs/ADR | [Docs router](docs/README.md), [ADR process](docs/adr/README.md) | `npm run test:docs` and static |
| Release | [Development](docs/engineering/development.md), [integrations](docs/engineering/integrations-and-operations.md), [updates](docs/product/app-updates.md)/[F-Droid](docs/engineering/fdroid.md) | Full pre-push gate |

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
7. Validate proportionally, then run the complete pre-push gate before pushing.

## Validation

Baseline: `npm run lint` and `npm run typecheck`. Feature tests are colocated;
`tests/vitest/test-discovery.test.ts` prevents suites silently disappearing from
Vitest or TypeScript. Do not increase the test-typecheck exclusion budget.

Run full E2E for runtime, domain state/services, protocol, shared persistence/query
infrastructure, dependencies/build/CI, root layouts, unmapped paths or changes across
more than two domains. See the [authoritative matrix](docs/engineering/validation/strategy.md#test-selection-matrix).

Before push, all of these must pass:

```bash
npm run test:ci:static
npm run test:fake-server:self
npm run test:e2e:budget
npm run build:storybook
npm run test:e2e:web
```

A red or flaky E2E run blocks push. Confirm and harden failures. Native/Android-risk
changes also require `npm run build:development:android`; preserve iOS and FOSS
entrypoints and use relevant device checks. Any edit under `tests/e2e/` or
`tests/fake-opencode/` requires explicit human validation even when automation passes.
Do not add E2E specs when existing owning specs or lower-level tests suffice; update
its budget in the same change when intentionally adding browser coverage.

For iteration, use `validate:fast`, `test:e2e:smoke`, `test:e2e:changed` or
`test:e2e:last-failed`. Concurrent runs use `test:e2e:web:isolated`; preserve per-worker
backend isolation. The full gate is still required before push/release.

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
