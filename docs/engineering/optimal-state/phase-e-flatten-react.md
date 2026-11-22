# Phase E — Flatten React

Status: **in progress**. Retained Terminal and Settings panes pass explicit
workspace targets through their screens and dialogs. Shared portal components
keep named modal hosts and receive interaction registration through props.
The projection registry remains.

Goal: remove the remaining scope/provider carriers from React. The app mounts
one core provider and one Query provider; workspaces are keys, not mounted
provider subtrees. Shared UI no longer imports runtime.

Read the [phase index](README.md), [feature boundaries](../../architecture/feature-boundaries.md),
and [ADR 0013](../../adr/0013-source-owned-ui-and-complex-forms.md) first.

Start only after Phase D is complete and green.

## What remains today

- `runtime/workspace/workspace-context.tsx` owns `WorkspaceContext` for
  registry access and the app-level share view. Workspace actions bind directly
  to the core.
- The root still mounts `runtime/workspace/retained-project.tsx` for each
  project. The registry retains project projections. Focus changes when the
  requested projection is ready, including when a server URL edit replaces
  the connection identity.
- Connection and project adapters pass Query identity and demand explicitly.
  Query has one app-level provider.
- Onboarding and preferences read device facts directly from the app store.
  Preference updates reconcile model choices against the scoped Query catalog.
- The core retains terminal controllers by workspace key. Terminal views read
  opened PTYs from the app store and the list from Query.
- The app core runs automatic approval from Query and the per-connection
  policy. Settings reads pending permissions and questions from their owning
  partitions.
- Diagnostics reads transport state from the connection manager and the app
  store, and selects health and MCP results from Query.
- Diagnostics and extension views resolve their own workspace through a shared
  core selector. Extension mutations check the exact client before a write.
- MCP controls and saved permission rules select the owning Query entries.
  The core clears a connection's MCP authorization prompt from scoped status.
- Core navigation and failover wait on the connection manager. The project
  projection still signals project readiness during a focus change.
- Connection controls are composed at the app shell. Profiles, Projects,
  Sessions and native surfaces read lifecycle state from the connection manager.
- Worktree writes run in the owning service. The core gets the root project's
  guarded client when creating a chat in a new checkout.
- Project headers and pickers read catalog, location, worktree and VCS data
  from Query. The remaining project projection still supplies action handles.
- `runtime/core/workspace-selectors.ts` selects the retained project projection.
- [ADR 0052](../../adr/0052-explicit-overlay-dependencies.md) records explicit
  portal targets and update blocker callbacks. Shared controls use shared imports.
- Projects, Sessions, Connections and Chat own their presentation and device
  types. Transcript reads and connector management have dedicated shared contracts.

The development app launched on an iPhone 17 Pro simulator running iOS 26.5.
The independent Settings pane opened the connection sheet and a nested native
form. The URL field accepted input, Back restored the entered address, and
Save & connect reached the loopback OpenCode 2 fixture. The full native
checkpoint remains.

The simulator also opened and dismissed the project picker inside the new
terminal sheet, created a PTY, and retained its output and single WebSocket
across Chat and Terminal tabs. The terminal now guards the native bridge
method before it is registered. Expo's development runtime still logged
early `DomWebView` tag lookup errors on mount. The renderer recovered and
showed output. Recheck with the final native build.

The ARM64 Android development build launched on an API 36 emulator. Hardware
Back dismissed the keyboard, returned from connection details with the typed
URL intact, and closed the provider setup screen and the opening screen selector
without exiting onboarding. Save & connect reached the loopback V2 fixture.
In Settings, Back closed the theme selector first and then closed the Appearance
sheet. After the terminal controller refactor, the emulator created a PTY and
preserved its output and one WebSocket across Terminal, Chat and Terminal.

## Target shape

- One `AppCoreProvider` and one `QueryClientProvider` at the root.
- A focused target selector in the store; scoped panes receive an explicit
  target prop or a feature-owned scope selector.
- No `WorkspaceScope`, `WorkspaceValuesContext`, `valuesFor`, snapshots or
  retained-focus registry.
- No shared UI import from runtime.
- Domain types live with their owner. Shared contracts are specific to an
  interface such as transcript reads or connector management.

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
   runtime. Delete the shared UI blocker bridge and its architecture exception.
5. Distribute the former shared domain types to their owners.
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
