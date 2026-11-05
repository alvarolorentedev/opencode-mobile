# Plugin GUIs

Back to the [architecture index](README.md). Decision:
[ADR 0027](../adr/0027-sandboxed-mobile-plugin-gui-host.md).

OpenCode V2 plugins may ship a `./gui-experimental` CommonJS bundle. The mobile
app loads that bundle into an Expo DOM WebView and mounts its first `Panel`.
There is no per-plugin code in the app: discovery, loading and rendering are
generic.

## Transport and loading

1. The Extensions plugin tab lists active plugins whose `features.gui` is true.
2. `GET /api/plugin/gui?id=<id>&location[directory]=…` returns
   `{ code, revision, options }`. The app uses the connection's authenticated
   fetch pipeline (`features/extensions/services/plugin-gui-service.ts`).
3. `features/extensions/ui/plugin-gui-loader.ts` evaluates the bundle with a
   local `require` map. `plugin-gui-modules.ts` provides `solid-js`,
   `solid-js/web`, `solid-js/store`, the local SDK shim, RPC tokens and file,
   review and browser contract tokens. Unknown modules fail closed; Electron
   and Node built-ins are inert placeholders.
4. `plugin-gui-sdk.ts` provides `Plugin.define`, registries, contracts, stores,
   `usePlugin`, `usePanel`, `bindPlugin`, `createKeyed`, `createLatest` and
   `createVisitState` for the WebView.
5. `plugin-gui-runtime.ts` creates a Shadow DOM root, provides `ctx`, runs the
   window `setup`, injects `Style` into the shadow root and renders the first
   panel with `solid-js/web`.

The published `@opencode/plugin` package currently blocks its host entrypoint
(`./gui/host`), so the loader and SDK shim live in this feature. They mirror the
documented window contract, not the desktop host implementation.

## Supported profile

`MOBILE_GUI_API = 1` supports:

- identity, options, app metadata, signal, `t`, `plural`, `add`, `list`;
- sessions (current), servers (the active connection), RPC and current-session
  reads, tabs (single session route), layout (full-screen panel), storage and
  declared stores, dialogs (`confirm`, `alert`, `prompt`, `select`), toasts,
  attention as an in-view toast, system copy/save/openExternal, locale,
  appearance, router and workspace events;
- `Panel`, `Command`, `MenuItem` and `Style` registries, plus a small DOM
  `ctx.ui` kit.

Unsupported or inactive: `ctx.main`/Ipc, `ctx.embeds`, `ctx.desktop`, native
menus, function-valued contracts across plugins, `ctx.dialogs.open` and native
`ctx.ui` components. A plugin that requires one of these fails closed or shows
an unavailable state; it is never half-registered as a native surface.

Known limits of this first profile:

- RPC events are not pushed into the WebView; plugins that only listen for
  events must poll, as flowgraph does.
- `ctx.storage` and declared stores are in-memory for the lifetime of the panel.
- `ctx.screen` is undefined; composer and file-tree APIs are not exposed.
- `ctx.layout` is a full-screen panel, not a side region or a session tab strip.
- The host renders one panel at a time. When a plugin contributes more than
  one panel, the screen shows a panel switcher and defaults to the first.

## Security boundary

- Plugin code runs in a WebView, never in the React Native realm.
- The WebView receives no server credential. `ctx.client.rpc` and
  `session.get` call native callbacks; RPC ids are scoped to the plugin and
  session reads are restricted to the routed session.
- Direct `fetch`, XHR, WebSocket, EventSource, `sendBeacon` and `window.open`
  are blocked best-effort before the bundle evaluates. This is not a process
  sandbox; a sandboxed iframe with CSP is the follow-up.
- `Style` is injected into a Shadow DOM root, not the app document.
- External URLs are limited to http(s)/mailto; plugin toasts and dialogs render
  inside the host chrome.

## UI

- A puzzle button appears in the chat header, between New chat and Usage,
  whenever the connection has at least one active plugin advertising a GUI
  (`features.gui`). It is not gated on the selected session, so it shows on
  every chat — including a brand-new empty one — on that connection. One plugin
  opens directly; several show the picker. The button is absent while the list
  is loading or empty. The list stays observed for the active workspace and is
  refetched on plugin/config/command updates, so a location that is still
  booting cannot leave an empty list cached and hide the button.
- The selected plugin renders in a large bottom overlay (about 72% of the
  window) with the host header and WebView. The overlay closes with Back, Close
  or the host's close action.
- When a plugin contributes more than one panel, a dropdown at the top of the
  overlay selects the visualization; the first panel is the default.
- Settings → Extensions still owns plugin installation and removal. GUI launch
  is intentionally in the chat header, not Settings. The standalone
  `/plugin?id=<id>&session=<id>` route remains a deep-link fallback.
- `ctx.tabs.open` and the panel session button use in-app workspace navigation
  (`openSessionInProject`) with the current session directory, not the external
  `/session/<id>` deep link, so the project context is preserved. Failures stay
  in the panel error state.
- With no session selected the overlay falls back to the connection directory,
  so globally installed plugins still render and can offer their own
  run/session picker.
- `Panel.mobile` is used as the panel title; `Panel.list` receives the panel id
  in `open`, so a plugin's own stored-tab logic still works.

## Validation

- `features/extensions/__tests__/plugin-gui-loader.test.ts` covers CJS default
  exports, main-only plugins, missing setup, newer API versions and unknown
  modules.
- A local Playwright harness evaluates the real flowgraph 0.6.0 bundle, runs its
  setup, renders mermaid, opens a session from a graph node and shows its cancel
  dialog. This is the device-independent smoke check for the host contract.
- Device validation is still required for WebView lifecycle, memory, keyboard,
  safe areas and accessibility.
