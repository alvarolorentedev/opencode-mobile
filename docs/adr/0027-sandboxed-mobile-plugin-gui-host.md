# ADR 0027: Sandboxed mobile host for OpenCode GUI plugins

- Status: Accepted
- Date: 2026-11-03
- Deciders: maintainers
- Supersedes: —
- Related: [plugin GUIs](../architecture/plugin-guis.md), [feature boundaries](../architecture/feature-boundaries.md), [API contract](../architecture/api-contract.md)

## Context

OpenCode V2 plugins may ship a `./gui-experimental` CommonJS bundle. OpenCode
Desktop evaluates that bundle in its renderer and gives it a broad `ctx` API.
The mobile app has no equivalent host: it has no desktop side region, session
tab strip, Electron main process, `WebContentsView` or native application menu.
The published `@opencode/plugin` package also does not export the host loader or
the Solid contexts that `usePlugin` and `usePanel` read.

Running third-party bundles in the app's React Native realm would expose the
server credential and the whole app state. That is not acceptable for npm code.

## Decision

Host plugin GUIs in the existing Expo DOM WebView surface, one plugin per view.
Evaluate the CommonJS bundle with a small local loader and a capability-scoped
`ctx` shim implemented in `features/extensions/ui/`:

- provide identity, options, app metadata, i18n, sessions, servers, RPC/session
  reads, panels, styles, dialogs, toasts, storage, layout, tabs and the small
  `ctx.ui` DOM kit;
- leave `ctx.main`/Ipc, `ctx.embeds`, `ctx.desktop`, native menus, contracts and
  native UI components unsupported or inactive;
- pass **no** server credential into the WebView; RPC and session reads go
  through a native bridge that uses the connection's authenticated client;
- scope RPC calls to the plugin id, allow only the current session for
  `session.get`, validate external URLs, and block direct network APIs in the
  WebView;
- render plugin styles into a Shadow DOM and mount the selected panel in a
  large chat overlay, defaulting to the first. Multiple panels get a host
  dropdown. This is the profile implemented at `MOBILE_GUI_API = 1`.

The bundle format is not changed. The host treats it as a public, unstable
input: unknown modules, a newer `api`, a missing export, or a setup failure
fails closed and leaves the host usable.

## Consequences

- Flowgraph, and other panel-first plugins, can render without app-specific
  branches.
- The host does not support the full desktop contract. Plugins using `ctx.main`,
  `ctx.embeds`, `ctx.desktop`, contracts or native `ctx.ui` are degraded or
  unsupported; the UI must say so.
- The WebView is a security boundary, not a process sandbox. Direct network is
  blocked best-effort; a future bridge inside a sandboxed iframe with CSP is the
  upgrade path.
- Plugin UI is DOM, not native. Accessibility, dynamic type and safe-area
  behavior need host chrome and device validation.
- The local loader and `ctx` shim must track the experimental upstream API and
  the `MOBILE_GUI_API` profile.

## Alternatives considered

- **Full desktop host shim:** rejected for now. It requires reimplementing the
  desktop side region, tabs, palette, settings, native UI kit and main process,
  and the published SDK does not expose the host contexts.
- **Run bundles in Hermes with a DOM shim:** rejected. Solid DOM, CSS and mermaid
  require a browser rendering engine.
- **Declarative mobile view model over RPC:** safer, but not compatible with
  existing `gui-experimental` plugins; retained as an opt-in future mode.
- **Embed the OpenCode web app in a WebView:** rejected as a mobile host. It is
  not native UX, and the web app does not load third-party GUI bundles.

## Follow-up

- [x] Add the generic loader, capability-scoped context and panel route.
- [x] Add flowgraph-compatible RPC/session/panel fixtures and loader tests.
- [ ] Add a manifest/API handshake upstream and broaden the supported surface.
- [ ] Move the plugin frame into a sandboxed iframe with an explicit CSP.
- [ ] Validate on iOS and Android devices.
