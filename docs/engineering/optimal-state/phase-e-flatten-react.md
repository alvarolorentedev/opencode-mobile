# Phase E — Flatten React

Status: **in progress**. Retained Terminal and Settings panes pass explicit
workspace targets through their screens and dialogs. Shared portal components
keep named modal hosts. The projection registry and update-blocker exception
remain.

Goal: remove the remaining scope/provider carriers from React. The app mounts
one core provider and one Query provider; workspaces are keys, not mounted
provider subtrees. Shared UI no longer imports runtime.

Read the [phase index](README.md), [feature boundaries](../../architecture/feature-boundaries.md),
and [ADR 0013](../../adr/0013-source-owned-ui-and-complex-forms.md) first.

Start only after Phase D is complete and green.

## What remains today

- `runtime/workspace/workspace-context.tsx` owns `WorkspaceContext` and
  `WorkspaceActionsContext` for registry access and commands.
- `runtime/workspace/workspace-provider.tsx` still owns the snapshot registry,
  `retainedFocus`, `publish`, `forget`, `valuesFor` and per-workspace
  `WorkspaceRuntime` mounts.
- `runtime/core/workspace-selectors.ts` selects the retained project projection.
- Three shared controls still import the update blocker through `runtime/ui.ts`.
- `shared/contracts/domain.ts` is still a type hub.

## Target shape

- One `AppCoreProvider` and one `QueryClientProvider` at the root.
- A focused target selector in the store; scoped panes receive an explicit
  target prop or a feature-owned scope selector.
- No `WorkspaceScope`, `WorkspaceValuesContext`, `valuesFor`, snapshots or
  retained-focus registry.
- No shared UI import from runtime.
- Domain types live with their owner; `shared/contracts/domain.ts` is removed or
  reduced to generics only.

## Portal and blocker strategy

The current exception exists because shared portal/sheet/select/dialog controls
need workspace scope for context identity and update blocking.

Pick one concrete strategy and apply it consistently:
- pass the focused scope/target as an explicit prop from the feature wrapper;
- or have each feature own a thin wrapper that supplies scope and blocking, while
  the shared control stays scope-free;
- or keep one shared `ScopeProps` type in `shared/` with no runtime import.

Do not add a new bridge context and do not let shared UI import the store. The
allowlisted exception must disappear from the architecture tests.

## Steps

1. Move the focused target lookup to a store selector. Remove the scope context
   carrier.
2. Convert retained panes (terminal, inspection) to explicit target props.
3. Remove the per-workspace snapshot registry and runtime mounts. Commands and
   selectors read store/Query directly.
4. Update shared controls and their feature wrappers so no shared file imports
   runtime. Remove `runtime/ui.ts` and its exception from the architecture test.
5. Distribute the `shared/contracts/domain.ts` types to their owners.
6. Verify portals, sheets, dialogs, selects, confirmations and update blockers
   on native and web.

## Phase E gate

```bash
npm run validate:commit
npm run build:storybook
EXPO_PUBLIC_E2E_MODE=1 EXPO_APP_VARIANT=development npm run build:web:ci
E2E_SKIP_BUILD=1 npx playwright test
```

Full 185-flow suite required at this checkpoint.

## Acceptance

- No production file imports `runtime/`, `WorkspaceScope` or `WorkspaceValues`
  from shared UI.
- No `valuesFor`, snapshot registry, retained-focus or per-workspace runtime.
- Portals, overlays, dialogs, sheets, selects and update blockers behave as
  before, including keyboard avoidance and Back.
- Storybook builds; full E2E passes.

## Pitfalls

- Portal ancestry is the hard part. Test a sheet opened from a scoped pane and a
  dialog opened from the focused workspace.
- Keyboard avoidance and `tabBarHideOnKeyboard` must not change.
- Do not replace one bridge context with another; either props or a feature
  wrapper.
- Native modal hosts and RTL direction need manual checks when available.
