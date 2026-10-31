# Feature ownership and import boundaries

Related: [ADR 0015](../adr/0015-feature-oriented-implementation.md) · [State and data](state-and-data.md) · [Runtime overview](overview.md)

## Read by task

| Task | Start with |
| --- | --- |
| Implement a product behavior | The owning feature's `AGENTS.md`, context and implementation |
| Change shared session/workspace lifecycle | `runtime/AGENTS.md` and [state ownership](state-and-data.md#state-ownership-overview) |
| Change transport or compatibility | `shared/protocol/AGENTS.md` and [API contract](api-contract.md) |
| Change a generic control | `shared/ui/AGENTS.md` and the [design system](../design/design-system.md) |
| Check the coordinated rename inventory | [File mapping](feature-file-map.csv), based on commit `1385f8e` |

## Product ownership

| Feature | Owns |
| --- | --- |
| `features/ai/` | Provider authentication/accounts, capabilities, models and routing |
| `features/chat/` | Composer, prompt lifecycle, transcript, diffs, usage and todo ledgers |
| `features/cloud-link/` | Subscription, pairing, machine access and connector services |
| `features/connections/` | Connection setup/profiles, retry and diagnostics presentation |
| `features/extensions/` | MCP, plugin, skill and command management |
| `features/notifications/` | Completion tracking, monitoring and activity coordination |
| `features/onboarding/` | Setup navigation and completion |
| `features/projects/` | Project catalog, files, worktrees and file clipboard |
| `features/sessions/` | Session lifecycle, library, favorites and approvals |
| `features/settings/` | Settings registry/search and panel composition |
| `features/sharing/` | Incoming-share staging, destination selection and attachment presentation |
| `features/terminal/` | PTY lifecycle, transports and renderer |
| `features/updates/` | Update policy, blockers and handoff |
| `features/voice/` | Conversation state machine, setup and presentation |
| `features/widgets/` | Widget snapshots, rendering and background task |

Feature directories use ui/, state/, services/, model/ and __tests__/ only
where needed. Presentation forwards actions and owns only local interaction state.
Services aggregate requests without owning state. Types and pure rules stay with
their domain. Stories remain beside the production components.

Domain-specific preference fields belong to their feature: Chat owns delivery and
response fields, Voice owns voice controls, and AI owns model controls. Shared UI
owns generic rows, inputs, targeting and disclosure mechanics. Language selection
uses the existing global preference contract in the shared i18n subsystem.

## Runtime ownership

`runtime/` owns cross-feature state and lifecycle composition. One application
owner retains registry/focus, persisted preferences and the stable presentation
map. One connection owner supplies lifecycle, event transport and session catalog.
Each connection/project branch mounts the existing domain hooks once and retains
its session selection, prompts, transcript, approvals, files, conversation and PTYs.
Screens do not mount those owners. Settings and Onboarding may compose other
features' public UI; this does not transfer ownership of their state.

`runtime/workspace.ts` is the consumer interface for workspace navigation, retained
presentation and entry-point readiness. Boot gating and focused shared-input access
read existing contexts; they create no additional state or bridge contexts.

Query client/scope/key infrastructure is shared; domain query factories stay with
their owner. Shared protocol services retain normalized session operations used by
several domains. Native voice/audio resources and attachment preparation are shared
device subsystems. Do not duplicate any of these inside a feature.

## Public feature APIs

- `index.ts`: named consumer UI, helpers and types used outside the feature.
- `context.ts`: the existing context objects and narrow subscription hooks. This
  separate leaf prevents portal scope restoration from loading feature workflows.
- `runtime.ts`: named headless hooks/services used by runtime and declared domain
  dependencies; never export feature presentation or workspace-consumer hooks.
- Existing background tasks have explicit `background` entrypoints; they are not
  re-exported by ordinary feature APIs.

Inside a feature, import its implementation directly. Across features, use a public
entrypoint. Do not use namespace imports or wildcard exports to enlarge an API.
The exact export lists and allowed feature edges live in `config/architecture.json`
and are checked by `tests/vitest/feature-boundaries.test.ts`. Feature dependencies,
including type imports, must be acyclic.

Use the existing `@/*` alias. There are no aliases or forwarding modules for retired
technical directories. Tests may import the internals they exercise without widening
the production API.

## Shared UI runtime exception

Shared code is feature-independent. The following existing scope-aware controls
alone may import `runtime/ui.ts`:

| File under `shared/ui/` | Exact permitted imports |
| --- | --- |
| `portal.tsx` | `WorkspaceScope`, `WorkspaceScopeContext` |
| `overlay-sheet.tsx` | `WorkspaceScopeContext`, `useUpdateBlocker` |
| `select.tsx` | `WorkspaceScopeContext` |
| `alert-dialog.tsx` | `WorkspaceScopeContext` |
| `catalog-select.tsx` | `useUpdateBlocker` |
| `use-confirmation.tsx` | `useUpdateBlocker` |

The API reuses existing context objects, scope restoration and blocker lifetimes.
It must not reach root composition, runtime mounts or feature presentation through
value imports. No other shared file can import runtime, including through a relative
path or re-export. There is no additional bridge context or duplicated state.

## Validation

Feature tests are colocated. Runtime integration tests stay in `runtime/__tests__/`;
repository-wide checks, harnesses, browser flows and fake-server fixtures retain
central owners. `tests/vitest/test-discovery.test.ts` independently walks the source
trees and proves every suite matches Vitest and TypeScript test configuration.

Existing architecture checks still enforce the 60-line provider entrypoint, 500-line
source ceiling, 127-member combined context surface, compatibility isolation,
keyboard/tab layout and retained-state ownership. New checks enforce public imports,
feature cycles, presentation IO boundaries and the exact shared UI exception.
See the [validation strategy](../engineering/validation/strategy.md) for commands and
test selection; this migration requires the complete gate and native entrypoint checks.

## Coordinated migration verification

Baseline: local main at `1385f8e`, including the completed state/query migration.
The rename inventory covers every tracked baseline file. Comparing executed test
identities (mapped file and full test name) found zero missing or renamed cases:
132 existing suites and 834 existing cases remain; two new architecture/discovery
suites add four cases, for 134 suites and 838 passing tests. Existing behavioral
coverage is sufficient because the migration changes ownership and imports only.
No E2E or fake-server fixture changes are included.

Validation completed for this migration:

- CI static gate: lint, application/test TypeScript, all Vitest suites, documentation,
  protocol/size/context ratchets and module/feature dependency checks.
- All 174 browser flows, unchanged 19-spec budget, fake-server self-tests and Storybook build.
- Android development compilation and APK assembly; packaging passed on a cached retry.
- iOS prebuild and bundle export; FOSS Android bundle export and preparation self-test.
- i18n registry and UI-token generator check modes.

The FOSS preparation test used fresh copies of the installed package versions,
since the shared local dependency cache had already been prepared. Signed iOS
archives and physical-device execution were not performed. Revert the coordinated
migration commits to roll back; serialized data and protocol contracts need no conversion.
