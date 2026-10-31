# Screen Controllers And Platform Surfaces

Route-level controllers and platform-specific presentation surfaces. Back to the [component inventory](../component-inventory.md).

## Screen Controllers

### `features/projects/ui/projects-screen.tsx`

#### Responsibility

- wire project selection to the provider
- wire the provider browser, preview, and shared project picker
- combine folder/search, file status, and project catalog refresh
- keep picker/preview visibility and screen feedback local

#### Presentation

- keeps the one-line workspace breadcrumb in the header: project selection is separate from the conditional worktree selector, with a larger project title and read-at-a-glance branch context
- the branch is shown once, in the header; the Files content title does not repeat it
- the shared picker lists the connection's opened projects, can close them locally, and can add a server directory as a project
- provides one project refresh action
- shows files directly with breadcrumbs and scoped search; worktree creation lives in New chat, not Projects
- opens file viewing and editing in a focused full-screen surface
- File entries reuse `SwipeRow` for Copy path, Rename and More. Long-press and
  More open `entry-action-sheet.tsx`; its `entry-action-content.tsx` renders
  type-aware actions or a focused rename form. `file-clipboard-strip.tsx` shows
  provider-owned Copy/Cut state and Paste/Clear. Errors stay visible, pending
  actions are disabled, and keyboard/back dismissal follows `OverlaySheet`.
- `features/projects/ui/file-preview.tsx` renders text editing, raster-image/audio/video previews, and a document/download fallback. Media bytes are prepared through the shared attachment cache helper, released on close, and capped at 25 MB. Download actions call the provider, which streams authenticated V2 file reads on native and creates a browser download on web.
- `shared/ui/media-preview.tsx` owns the shared audio/video players used by both chat attachments and project files

### `features/settings/ui/settings-screen.tsx`

#### Responsibility

- wire connection, diagnostics, provider, notification, and voice sections to the provider
- open provider OAuth URLs through an app-returnable auth session and capture a
  redirect code back into the app
- poll for automatic OAuth completion and show headless/device-code pairing
  instructions, then submit code-based OAuth callbacks
- wire MCP runtime lifecycle and grouped OAuth methods/start/complete/wait/cancel actions to `McpSection`; expose persistent enable/disable only on v1
- declare every category once in a `SettingsSection` registry (`icon`, `title`,
  `summary`, `onPress`, `render`); the row list and the overlay both derive from
  it, so adding a category is a single entry plus its presentational component

#### Presentation

- `SettingsHome` renders searchable categories in App preferences, Connections,
  and Selected server order from the section registry's `group` and `targets`.
- Appearance, Chat & responses, Voice & audio, Notifications, Language and
  About & support replace the mixed App settings sheet. Cloud Link follows
  Connection and retains its store-install gate; diagnostics is named directly.
- Category sheets use `OverlaySheet` with a `SettingsPanel` scroll area and fixed
  title/Close header. Full-screen service editing restores Cloud Link on return.
- `SettingTarget` reveals/highlights a matching localized label without changing
  its value. `SettingsDisclosure` expands for a search group or attention state.
- `SettingSwitchRow`, `SettingSelectField`, `SettingField`, `SettingSlider`
  and `Button` share wrapping copy, theme colors and accessible targets;
  the same components are reused by setup. Technical setup uses disclosures.
- Search metadata is gated with the same platform/capability state as controls,
  and never includes credentials/current values. Server/project inspection
  continues through the existing independent workspace scope.
- See [design-system.md](../design-system.md) for component contracts, interaction
  states, foundations and the checklist for future features.
- See [Storybook](../storybook.md) for live examples of the shared settings
  controls and other reusable primitives.

### `app/(tabs)/terminal.tsx`

#### Responsibility

- fourth tab and thin controller over provider-owned PTY state
- render a content-sized PTY selector overlay; each terminal opens on tap and reveals Close on swipe
- refresh the PTY list when the tab regains focus or the selector opens; there is no header refresh action
- create default-shell PTYs and select/reconnect existing PTYs
- delegate rendering and keyboard controls to `features/terminal/ui/`
- stream immediate terminal input through provider actions; the server owns line editing/history

### `features/sharing/ui/share-screen.tsx`

Thin preview/controller over provider-owned `sharedInput`: resolving, setup,
empty/error, shared text/link, attachment tiles and skipped-item warnings.
Shows the current conversation by default; Change opens the existing OverlaySheet
with searchable conversation rows and project labels, plus New chat in the
current project. The project picker remains available when setup is needed.
Choosing a conversation only selects the pending destination. Add awaits the
provider's guarded create/open action before navigating to Chat. The composer
merges the confirmed receipt exactly once and remains the only send path.
Discard cancels and clears staged content. Components never fetch or persist.

## Android widget presentation

`features/widgets/ui/session-widget.tsx` renders Latest replies, Awaiting actions and Plan
progress as RemoteViews. Height determines one to three rows; both palettes,
accessible names, text truncation and absolute update timestamps are shared.
The renderer opts out of React Compiler with a module-level `"use no memo"`
directive: the widget library calls it outside React, where compiler-injected
hooks cannot run. Trees use supported widget primitives instead of React
Fragments, which the serializer cannot handle. The same renderer serves
foreground updates and headless add/update/resize tasks.
`SessionWidget` retains its native identity; `AttentionWidget` and `PlanWidget`
are separate gallery entries. Taps only open the app or validated chat links.
The Android General section exposes Show widget previews; turning it off removes
reply/request excerpts and step text while preserving titles, counts and status.

## Terminal presentation

`terminal-screen.tsx` composes the existing picker, header, creation and termination
actions, reconnect errors, and padding keyboard layout. `terminal-view.tsx`
registers renderers with the provider and adapts Expo DOM acknowledgements,
clipboard operations, and multiline/control-character paste confirmation.

`terminal-dom.tsx` retains xterm instances inside one DOM surface, receives
imperative output batches, reports fit dimensions, and sends ordered input.
The surface stretches to the host root (Expo DOM mounts into a row-direction
flex `#root`), so tablet and landscape widths reach the fit addon instead of
being capped by the accessory row.
`terminal-accessory.tsx` renders Esc/Tab/Ctrl/Alt/Shift/arrows/Fn plus F1–F12,
Home/End/PageUp/PageDown/Insert/Delete/Paste. A modifier tap arms it once, a
double tap locks it, and another tap clears it. Terminal/tab changes clear modifiers.
Every accessory tap re-focuses the terminal textarea inside the gesture (arrows
already did) so modifier, Fn, Copy, and Paste taps keep the soft keyboard up.
Shift modifies accessory/navigation keys and capitalizes ASCII letters; the
system keyboard supplies shifted punctuation and composed text.
`terminal-keys.ts` encodes accessory combinations and terminal cursor modes.
`terminal-input.ts` forwards system `insertText` events omitted by xterm in
screen-reader mode, without duplicating physical-key or composition input.

Touch long press selects a word, drag extends selection, and Copy uses the
platform clipboard. Touch scrolling stays local rather than generating shell
mouse events. The Latest output control appears away from the scrollback bottom.
Buttons have at least 44-point targets, accessible names and state, and xterm
screen-reader mode is enabled. Native screen-reader/input validation remains required.

## Project file browser components

- `features/projects/ui/files-panel.tsx` renders sorted folders/files, breadcrumbs,
  explicit project-wide search scope, changed files, loading/empty/error states,
  and retry actions. Only the unsubmitted search input is local; listing/search
  state and actions come from the provider's `browser` member.
- `features/projects/ui/file-preview.tsx` renders the full-screen text preview,
  local edit draft, save feedback and discard confirmation. It calls the existing
  provider save action; unsupported editing is capability-gated.
- `features/projects/ui/worktree-picker.tsx` renders the selection-only
  `WorktreeSwitcher`, with a separate management mode for removal. It reads the
  inventory when the sheet opens and on worktree events; a failed read offers
  Retry instead of a permanent refresh action. Creation is owned by New chat;
  inventory and lifecycle actions remain provider-owned.

These surfaces reuse the existing palette, theme, slim preference, inputs and
picker overlay. Projects retains its tab label and route. Chat reports the
workspace read-only; its chat library keeps the shared picker and provider
selection action. Terminal follows that directory.

## App update notice

- `features/updates/ui/update-notice.tsx`: compact, translated nonmodal ready/App Store
  banner above the tabs, transparent handoff interaction gate and failure snackbar;
  Android's available prompt and visible installation UI are owned by Google Play.
  All actions come from the provider.
- `features/connections/ui/connection-status-banner.tsx`: compact translated transport
  notice in chat for offline, connecting, automatic reconnect, polling fallback,
  and constrained links. It never replaces a populated transcript and reads only
  provider-owned connection/diagnostics state.
- `runtime/presentation/use-update-blocker.ts`: registers open/busy local surfaces with the
  existing provider without sharing their content.
- `modules/opencode-updates`: local Expo Android Play update module and iOS
  verified-installation helper. See [app updates](../../product/app-updates.md).

## Multi-server V2 surfaces

- `chat-library.tsx`: existing row and swipe treatment in one mixed list; server chips that stay visible below long titles, an in-flight row indicator while a chat opens or is managed, search, server/project dropdowns and the sole Hide subagents toggle. Its New chat action closes the library and opens the New chat sheet. The previous compatibility view is retained in `chat-library-v1.tsx`.
- `new-chat-sheet.tsx`: confirms server, project, and checkout, and is the only worktree creation entry point. It can create a worktree and start the chat, with partial-success recovery.
- `project-picker.tsx`: connected server groups, search, and project-only rows. Worktree selection is a separate second-level control.
- `new-terminal-sheet.tsx`: confirms server, project and resolved cwd before PTY creation. `retained-terminals.tsx` holds the renderer hosts; the terminal picker lists all retained owners.
- `server-context-picker.tsx`: independent Settings server/project inspection. Server selection lives on Settings home; server category sheets keep its read-only context caption and only retain the project picker for MCP/diagnostics. AI & Providers, MCP, diagnostics and approvals receive that context; app preferences remain global.
- `server-approvals.tsx`: pending requests/questions, saved grants and per-server auto-approve, reusing chat permission cards and existing server actions.
- `workspace-select.tsx`: the house CatalogSelect with an outlined button trigger. `OverlaySheet` bridges workspace context through the RN Primitives portal host.

Terminal selection uses one continuous list with a server chip on each row, without empty workspace headings. With one connected workspace connection, server filters, selectors, chips and redundant scope labels are hidden across Chat, Projects, Terminal and Settings; both Settings section headings, project context and connection management remain available. Servers that are disconnected, connecting or unavailable are omitted from server and project selectors; cached chat rows keep their ownership visible, and Connection management still lists saved profiles for Connect and Reconnect. Multi-server controls return automatically when a second connection is connected.
