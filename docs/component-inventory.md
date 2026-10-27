# Component Inventory

## Chat attachments and pending messages

`attachment-strip.tsx` renders shared 56 px square tiles in the composer,
pending stack and message cards, above each message's text. Images fill the tile;
audio and documents use icons. Filename labels remain available to assistive
technology. Composer removal is a separate 44 px action.

`attachment-preview.tsx` uses the existing overlay sheet for images, selectable
text, explicit audio playback, and inline video playback. Closing/backgrounding
stops media; temporary native files are released. PDF/Office documents use the
system share/viewer on native and browser download/open on web. Preview loading
and URI/file handling live in `lib/attachment-preview.ts`, with the existing
10 MB limit. Declared oversize and encoded data are rejected before allocation; unknown-size downloads stop at the streamed limit. Closing/backgrounding aborts pending reads, and local originals are never deleted. Image tiles and the full image preview use contain fit; the preview
fills the sheet's available height. The audio and video players live in
`components/ui/media-preview.tsx` and are shared with project file previews.

`pending-prompts.tsx` renders provider-derived OpenCode 2 sending/waiting entries
in a bounded, scrollable stack directly above the composer. It does not own
prompt admission or delivery state. Waiting entries expose a close action that
cancels the inbox item; when the composer is empty, its text moves back into the
composer. Sending entries keep the action disabled until admission completes.

`revert-notice.tsx` renders a muted session-level notice above the pending stack
while a revert is staged. Its close action cancels the revert. The reverted
prompt text is edited in the composer, so the notice only carries status and the
cancel affordance.

Steer/Append selection lives at the top of
the Editor group in Advanced Settings, alongside chat text size and flat
conversation. The General group contains slim interface, language and Reset
onboarding, which reopens the existing setup review without clearing settings.

## Purpose

This document inventories the current UI and support components, their responsibilities, and their prop contracts where relevant to parity.

The goal is to make it possible to rebuild the UI tree without having to rediscover each component's role from source.

## Chat Components

## `components/chat/chat-view.tsx`

### Responsibility

- main chat screen controller
- bridges provider state to presentational chat subcomponents
- owns local UI state for draft, attachments, menu visibility, speaking state, snackbars, and voice draft capture
- renders the chat approval alert for `approvals.mcpAuth` (MCP authentication required) with Open link and Dismiss actions

### Important local state

- `draft`
- `attachments`
- `changesVisible`
- `progressVisible`
- `chatLibraryVisible`
- `isUpdatingAutoApprove`
- `newChatVisible`
- `isStoppingSession`
- `expandedDiffId`
- `copiedMessageId`
- `speakingMessageId`
- `voiceFeedback`
- `sendFeedback`
- failed input retained by `use-chat-draft.ts` when a newer composer edit prevents automatic restoration; the error card explicitly merges it back on Restore failed message

### Main responsibilities

- determine whether current session is running
- filter transcript into display entries
- coordinate copy-to-clipboard and TTS playback
- coordinate draft speech recognition
- attach files through document picker
- route prompt send / abort actions
- provide the complete filtered transcript to the virtualized chat list
- open/create sessions and toggle conversation mode
- execute exact server-provided slash commands
- route fork, revert, and revert-cancel actions
- place a reverted user prompt in the composer for editing; sending commits the staged revert
- discard a waiting steer/queue prompt and move its text into an empty composer

### Main child components

- `ChatHeader`
- `ChatLibrary`
- `TranscriptList`, `ChangesOverlay`, `PendingInteractions` (from `components/chat/content/`)
- `PendingPrompts`, `RevertNotice`
- `ChatComposer`
- `Snackbar`

## `components/chat/content/`

### Responsibility

- `transcript-list.tsx`: render the transcript area, empty states, connection issues, and load older history on scroll-up; running progress lives on the newest activity header (including after its tools complete) and the active child row instead of a separate footer; revert status and cancellation live in the composer notice
- `changes-overlay.tsx`: render the Files changed overlay with refresh, scope selection, and diff accordions
- `pending-interactions.tsx`: render server-owned tasks, permissions, and questions, including the compact progress view

`ChatView` renders these leaves directly and passes the values assembled by
`useChatViewController`'s `content` / `composer` / `actions` namespaces. There is
no intermediate `ChatContent` pass-through; it was removed so the prop surface is
declared once, at the leaves.

### Behavior notes

- Chat keeps its transcript and pending cards mounted while changes are reviewed.
- transcript messages use FlashList virtualization; it starts at the bottom, follows additions only from the bottom, and preserves the visible position otherwise. Because FlashList measures progressively, the tail is re-asserted across a few frames on a session switch or data change, and the list re-applies its tail/offset when the Chat tab regains focus or the app returns to the foreground, so an Android detach or background/lock cannot leave it at the top or undrawn. A starter-prompt card is shown only for a session with no transcript content; the skeleton is shown for target bootstrap or a cold fetch with no held records. The initial pull is one newest window of up to 200 records, and each scroll-to-top loads one older 200-record batch without a backfill loop.
- The transcript always renders the detailed native timeline. Details are first-class activity rows (`cards/activity-group.tsx` + `cards/activity-item.tsx`): contiguous reasoning, tool, and patch details merge into one two-level run whose content grows as streamed details arrive, and a message bubble breaks the run. The level-one header keeps the total tool-call count and lists every rendered type once, including `Thought` when reasoning is present, or `Thought · N` for a reasoning-only run; runs start collapsed, active work only shows the progress affordance, and an explicit manual toggle is the only thing that expands them. Level-two rows: thoughts expand markdown; shells show the command collapsed and a selectable, copyable code block expanded; grep stays a one-line pattern plus match count; consecutive reads collapse to one non-expandable comma-separated filename list; edit/write/patch tools render per-file diff cards with `+N −N` and an expandable unified diff. Run rows use the assistant bubble width. V1-only subtask/step/agent details and the `step-finish` usage marker are never rendered.
- A centered changes chip above the composer shows file count and green additions/red deletions for the selected scope. It hides at zero files and omits line totals for filename-only patches. Tapping opens the shared Files changed overlay with refresh, source selection, and diff accordions. Changes use a compact bottom sheet (55% of the viewport where safe areas permit), a centered file-count title, close icon, and a three-dot source button instead of separate summary/source cards.
- Changes overlay scopes: `Turn` (per-turn snapshot diff, with a picker when multiple turns have diffs), `Uncommitted`, and `Branch` (VCS working tree / default-branch diffs)
- displays starter prompts only when the selected session has no transcript content at all

## `components/chat/chat-composer.tsx`

### Responsibility

- render a rounded text area with a bottom toolbar: attachment, direct approval toggle and agent-mode icon, model/reasoning summary, dictation, and voice/send/stop
- expose supported Approvals only through a direct toolbar toggle (shield when asking, warning when auto-approving); hide it for unsupported V2 servers
- open the existing agent selector from a mode icon beside Approvals
- open the model picker from the selected model/reasoning summary, with a reasoning slider above model search
- dismiss the keyboard when opening selectors while preserving the parent-owned draft; model picker dismisses on Back/Escape or session/tab changes
- render optional conversation banner
- render the V2 suggestion panel for commands and context tokens, plus the shell-mode banner
- render attachments, voice status, prompt input, and action buttons
- On iOS the native multiline input grows itself between 44 and 110 px (40 to
  90 px in slim mode) and scrolls at the cap, so height never lags a layout pass
  behind the text. Paper's dense container floors the slim input at 40 px.
  Android and web retain content-size events and the explicit measured height.

### Prop contract

```ts
type ChatComposerProps = {
  attachments: { uri: string; mime?: string; filename?: string }[]
  availableAgents: AgentOption[]
  chatPreferences: ChatPreferences
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; isListening: boolean; phase: string; statusLabel?: string; wakePhrase: string }
  draft: string
  isSpeechInputAvailable: boolean
  isSpeechInputListening: boolean
  isStoppingSession: boolean
  isUpdatingAutoApprove: boolean
  onAttach: () => void
  onDraftChange: (value: string) => void
  onRemoveAttachment: (index: number) => void
  onSend: () => void
  onToggleAutoApprove: () => Promise<boolean>
  onToggleRecording: () => void
  onToggleConversationMode: () => void
  palette: Palette
  selectedAgentLabel: string
  showSendAction: boolean
  currentSessionId?: string
  visibleModels: ModelOption[]
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void
  commands: Command[]
  isV2: boolean
  suggestions: ComposerSuggestionGroup[]
  suggestionsActive: boolean
  suggestionsSearching: boolean
  suggestionsError?: string
  onSuggestionSelect: (suggestion: ComposerSuggestion) => void
  onSelectionChange: (selection: { start: number; end: number }) => void
  shellMode: boolean
  focusRequest: number
}
```

### Important parity notes

- todos are server-owned and displayed in the chat overlay with disabled status icons; the UI has no todo mutation action
- typing `/` shows matching server commands with descriptions; typing `@` shows agents, skills, project files, and references. Selecting a row fills the draft.
- a leading `!` switches the primary action to a V2 session shell command
- there is no dedicated composer palette button; the text triggers are the only entry point
- model selection uses a searchable sheet grouped by provider; its reasoning slider shows server variants for the selected OpenCode 2 model, including a synthetic Default, and stays hidden when that model has none
- the composer trigger includes the selected variant in its accessible name when the model provides variants

## `components/chat/composer-suggestions.tsx` and `use-composer-suggestions.ts`

- `chat-composer.tsx` renders the presentational suggestion rows above the input.
- `use-composer-suggestions.ts` owns only local trigger/query/file-search state; provider actions supply commands, agents, skills, references, and project file results.
- Commands and context are grouped and filtered by the active token; file search is debounced and the suggestion rows are keyboard-persistent.

## `lib/opencode/composer.ts`

- Pure trigger detection, token replacement, shell-command parsing, and final-draft mention resolution.
- Mention offsets are computed at submit time from the selected tokens, so edits and deletions cannot leave stale ranges.

## `components/chat/model-picker.tsx`

### Responsibility

- render the searchable, provider-grouped configured-model picker
- virtualize model rows with a bounded-height native `SectionList`, so opening a large catalog does not mount every model's text views at once
- pin a `Selected` and `Recent` section above the provider groups (hidden while searching)
- own only local modal visibility and search-query state
- return the selected `ModelOption` to the composer, which persists it through the provider
- render the shared numeric slider for the selected model's server variants
- render the trigger with the local `ControlButton`, including slim sizing for the slim-interface preference
- the transparent `Modal` sheet wraps its content in `GestureHandlerRootView` and dismisses on a downward header drag via the shared `useSwipeDismiss` helper, matching `OverlaySheet`

## `components/chat/chat-header.tsx`

### Responsibility

- top app bar with New chat and usage actions; New chat opens the server/project sheet instead of creating immediately, and voice chat starts from the composer waveform only
- active session and project title that opens the Chats overlay
- compact current-session usage summary and usage breakdown sheet
- mounting point for conversation overlay

### Prop contract

```ts
type ChatHeaderProps = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; feedback?: string; inputPhase: ConversationInputPhase; latestHeardText?: string; phase: ConversationPhase; readbackPhase: ConversationReadbackPhase; wakePhrase: string }
  insetsTop: number
  onConfirmStopConversation: () => void
  onCreateSession: () => void
  onOpenSessionMenu: () => void
  palette: Palette
  selectedSession?: Session
  activeProjectLabel?: string
}
```

`new-chat-sheet.tsx` reuses the terminal creation-sheet pattern: server
selector (only with multiple connections), project selector, resolved working
directory, and an explicit confirm action. Selection stays local until confirm;
the provider then creates and opens the session in that workspace.

## `components/chat/chat-library.tsx`

- Chats overlay with search, favorites, and swipe-left session actions
- active, favorite, and current-project rows share one FlashList scroll owner; search, filters, and New Chat stay outside the virtualized list
- "Active across projects" group above Favorites listing up to four running/recent sessions from the whole connection; listed IDs are removed from the Chat list below, and tapping one switches project and opens it through the workspace navigation action (`navigate`), not the external deep-link resolver. Project-scoped actions (rename/delete) appear only on the current-project rows
- re-seeds the cross-project snapshot when the overlay opens
- derives cross-project rows only while visible, and mounts the shared project picker only while its nested overlay is open, so a closed library does no per-publish catalog work
- keeps the Hide subagents switch alongside the Active filter
- header action opening the shared project picker overlay
- uses provider actions for switching projects, opening chats, and persistence
- owns only local search, section, swipe row, rename, and feedback state

## `components/ui/overlay-sheet.tsx`

- shared overlay presentation for Chats, project selection, progress, diff source selection, session usage, terminal selection, and Settings categories; short overlays fit their content
- `scrollable={false}` lets embedded virtualized lists own scrolling without a nested ScrollView
- a full-screen `KeyboardAvoidingView` with `behavior="padding"` contains the sheet; the sheet and its scroll area shrink within the visible space so focused inputs (including the speech locale) stay reachable above the keyboard
- dismisses on a downward header drag through the shared `useSwipeDismiss` helper, which owns the Pan gesture, threshold set, sheet-height measurement, and backdrop fade; the transparent `Modal` bottom sheets (model picker, select) reuse the same helper

## `components/ui/project-picker.tsx`

- shared Chat project button and project picker overlay also used by Project's existing dropdown
- renders the connection's opened projects; a row's close control removes it locally, and adding lets the user enter a directory on the OpenCode server that the provider resolves and selects
- owns no domain state or persistence

## `components/chat/chat-cards.tsx`

### Exported components

- `PendingInteractionsCard`
- `QuestionFlow`
- `SessionDiffCard`
- `DiffCard`
- `TranscriptMessage`

### `PendingInteractionsCard`

Responsibility:

- render session-scoped permission actions in the floating continuation area
- show the requesting session's title as `Requested by {{name}}` when the
  permission came from a subagent/nested session, so provenance is visible

### `QuestionFlow`

- full-screen step-by-step questions; preserve local drafts across dismissal
- collect single, multiple, or custom answers and submit on the last step
- render V2 form field types, conditions, defaults, and retry errors

### `SessionDiffCard`

Responsibility:

- render a structured diff (`FileDiff`/`VcsFileDiff`) using compact full-width rows with a left expansion chevron, filename, and green/red line totals; expanded previews wrap code within the sheet, using one old/new line-number gutter and existing collapsed-context blocks
- show a preview-unavailable line when the server reported changes without exposing patch content, and a no-line-changes line when a patch produced no renderable hunks

### `ChangedFilesCard`

Responsibility:

- render the changed files of one turn as a plain list when the structured turn diff is absent, with a localized title and a note that diff lines are unavailable for the turn
- it is never rendered as a diff, so a filename is never presented as patch content

### `TranscriptMessage`

Responsibility:

- render one display transcript bubble
- in flat mode (chat preference), drop the bubble chrome and side margins, render full-width rows with condensed spacing and a shared text color; the role label still distinguishes user and assistant
- with the slim-interface preference, reduce bubble padding and action-button sizes
- show copy state, optional TTS button, fork/revert actions for user messages, timestamp, markdown text, error, and summary chips
- an explicit copy button keeps copying available without capturing table-scroll gestures; taps still dismiss the keyboard

## `components/chat/chat-markdown.tsx`

### Responsibility

- render assistant/user messages with `react-native-enriched-markdown` in GitHub flavor
- code-block copy uses the same success haptic as the message bubble copy; it does not reuse the message bubble's copied pill or border, and it does not show a snackbar
- Code blocks use an opaque theme-aware background and syntax palette; user bubbles use the dark code palette because they stay dark in both themes. Blockquotes are transparent so the renderer's light blockquote default cannot bleed through in dark mode.
- Message bubbles stretch within their side margins; the renderer stretches within the bubble padding and keeps its measured content height. Avoid percentage widths inside content-sized bubbles, which can mismeasure native wrapping and height.

### Supported formatting

- Transcript Markdown text and line spacing follow the persisted chat text-size preference.
- GitHub-flavored Markdown, including tables, ordered and unordered lists, links, emphasis, blockquotes, and fenced code blocks
- native text selection and link handling on iOS/Android, plus semantic HTML rendering on web

## `components/chat/chat-overlay.tsx`

### Responsibility

- full-screen conversation-mode overlay
- shows session title, phase, the wake phrase while armed, last heard command, and stop button
- uses a three-line sine ribbon (`conversation-wave.tsx`) in the selected dark
  accent palette; the existing system microphone meter drives listening
  amplitude, while local capture and readback use phase-based motion
- pauses the ribbon on connection problems, honours reduced motion (including
  changes while open), and keeps End conversation outside scrollable content
  so large text and short screens retain access to the existing stop flow

### Inputs

- connection status
- top inset
- latest user text
- existing conversation microphone level (0–10, clamped for presentation)
- stop handler
- conversation input phase and readback phase
- session title
- configured wake phrase

## `components/chat/chat-diff.ts`

### Responsibility

- parse current unified `patch` hunks into line diff previews
- collapse large unchanged context sections
- derive diff palette by line kind

### Important behavior

- treats the common prefix and suffix as context and the middle as one changed block
- preserves context/add/remove rows with line numbers

## `components/chat/chat-view-utils.ts`

### Responsibility

- constants and tiny label helpers

Current values used by the UI:

- starter prompts list
- reasoning options list
- transcript page size = `20`
- auto-approve icon mapping

## `components/chat/chat-view-styles.ts`

### Responsibility

- centralized style sheet for most chat surfaces
- export `slimStyles`, parallel overrides applied on top of the base sheet when the slim-interface preference is on

This is important to parity because the chat layout is intentionally dense and highly composed, especially around:

- chat library
- message bubble geometry
- composer dock
- conversation banner
- task overlay

## Screen Controllers

## `app/(tabs)/projects.tsx`

### Responsibility

- wire project selection to the provider
- wire the provider browser, preview, and shared project picker
- combine folder/search, file status, and project catalog refresh
- keep picker/preview visibility and screen feedback local

### Presentation

- keeps its active-project title, path, and dropdown trigger in the header; the dropdown opens the shared project picker overlay
- the shared picker lists the connection's opened projects, can close them locally, and can add a server directory as a project
- provides one project refresh action
- shows files directly with breadcrumbs and scoped search; worktree controls live in the shared project picker
- opens file viewing and editing in a focused full-screen surface
- `components/project/file-preview.tsx` renders text editing, raster-image/audio/video previews, and a document/download fallback. Media bytes are prepared through the shared attachment cache helper, released on close, and capped at 25 MB. Download actions call the provider, which streams authenticated V2 file reads on native and creates a browser download on web.
- `components/ui/media-preview.tsx` owns the shared audio/video players used by both chat attachments and project files

## `app/(tabs)/settings.tsx`

### Responsibility

- wire connection, diagnostics, provider, notification, and voice sections to the provider
- open provider OAuth URLs through an app-returnable auth session and capture a
  redirect code back into the app
- poll for automatic OAuth completion and show headless/device-code pairing
  instructions, then submit code-based OAuth callbacks
- wire MCP runtime lifecycle and grouped OAuth methods/start/complete/wait/cancel actions to `McpSection`; expose persistent enable/disable only on v1
- declare every category once in a `SettingsSection` registry (`icon`, `title`,
  `summary`, `onPress`, `render`); the row list and the overlay both derive from
  it, so adding a category is a single entry plus its presentational component

### Presentation

- shows compact settings rows in one group and opens one category at a time
- places Cloud Link immediately below AI & Providers, and only when the provider
  resolved `connectSetup.storeInstall` (App Store or Google Play installs); its
  summary reflects initialization or verified access status
- opens the full-screen service editor route for Add/Edit and reopens the Cloud
  Link section when the route returns, without leaving a portal sheet over the
  pushed screen
- uses the same safe-area app header and title treatment as Chat and Terminal
- groups MCP servers and diagnostics under the `Advanced` category
- shows a `Language` category for the app interface language
- shows a `Support` category for store rating, feedback, and the support page
- shows compact category summaries and renders one category at a time in the shared overlay
- opens connection and provider forms in keyboard-safe full-screen surfaces

## `app/(tabs)/terminal.tsx`

### Responsibility

- fourth tab and thin controller over provider-owned PTY state
- render a content-sized PTY selector overlay; each terminal opens on tap and reveals Close on swipe
- create default-shell PTYs and select/reconnect existing PTYs
- delegate rendering and keyboard controls to `components/terminal/`
- stream immediate terminal input through provider actions; the server owns line editing/history

## `app/share.tsx`

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

`widgets/session-widget.tsx` renders Latest replies, Awaiting actions and Plan
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

## Settings Components

`connection-method-chooser.tsx` renders the shared Scan QR code (local network),
Manual, and Cloud Link choices in that order, plus a learn-more link.
`connection-setup-form.tsx` composes the chooser with two independent flows for
onboarding and returning from pairing: the scan choice opens the camera-only
`connection-scan-flow`, and Manual opens the manual profile form.
`connect-onboarding.tsx` presents the four-step Cloud Link assistant (learn,
computer setup, subscribe, pair), with shared illustration/heading/subheading
spacing and pinned primary actions. Pair reuses the computer drawing beneath a
thin transparent, theme-tinted corner frame outside the display. It owns only
clipboard feedback; step and
scanner visibility are local presentation state in `connect-pairing.tsx`.
`connect-camera-gate.tsx` requests permission only after Scan QR code (including
the Connection section's local Scan QR code choice); denial returns to the
illustrated Pair step.
`connect-pairing.tsx` retains the existing scanner, appbar options, link fallback
and recovery overlays. Deep links bypass the assistant and camera gate. Returning
subscribers start on Pair; native subscription verification and pairing remain in
the provider. `connect-scanner.tsx` owns camera presentation/lifecycle and only
previews after permission is granted.
`connect-subscription.tsx` reuses native offers and explicit purchase/Restore.
Its assistant layout has a static single-offer summary (selection for multiple
offers), native pricing at body size, inline recovery, and a Restore text link
above Subscribe & continue. Other Settings/management callers retain their
existing compact layout.
`sections/cloud-link-section.tsx` renders the consolidated Cloud Link surface in
this order: the access summary, the connector's exposed services (when a Cloud
Link connection is active), Subscription actions (native store management,
offers when inactive, one Restore row), and a Machines shortcut to the existing
management route, closing with a learn-more row. It uses the shared Settings
overlay and provider state; it
never opens the camera or starts a purchase merely by opening the section.
`connect-panel.tsx` renders the separate machine/profile management view. `app/pair.tsx` ingests links and navigates only; deep links skip the camera gate.
Domain state/actions come from `useConnection().connectSetup`; see [Cloud Link](connect.md).

After a valid Cloud Link claim, the pairing surface shows desktop-confirmation
progress and hides recovery controls while the provider checks activation. A
delayed activation uses neutral text with Retry and Scan the new QR code on your
computer; the scan action resets the provider checkpoint and resumes the existing
scanner. It preserves stored profiles. Components do not poll or classify errors.

## `components/settings/sections/`

### Section components

- `EditorSection`
- `GeneralSection`
- `UpdateSection`
- `ConnectionSection`
- `CloudLinkSection`
- `ServicesSection`
- `AiDefaultsSection`
- `NotificationsSection`
- `VoiceSection`
- `LocalVoiceSection`
- `ResponsesSection`
- `LanguageSection`
- `DiagnosticsSection`
- `SupportSection`

### `ConnectionSection`

Responsibility:

- show connection state card
- show the current connection message or error hint from provider state
- render the saved-connection list (`ConnectionProfiles`)
- offer Scan QR code (local), Manual and Cloud Link creation choices through
  `Add connection`

The server URL/username/password fields are no longer a standalone form; they
live inside the connection rows (current connection row) or the add/edit
dialog, so there is a single place to configure a connection.

## `components/settings/connection-profiles.tsx`

### Responsibility

- list saved connections as collapsible rows with name, host, and an Active/Connecting badge
- expand a row to see its server URL and username and to reach Connect, Edit, and Delete
- always render a `Current connection` row when the active connection has not been saved as a profile, so the live connection stays editable
- switch to a saved connection through `switchConnection()` (which persists the outgoing profile's model selection, restores the target's, and reconnects)
- add a connection through `Add connection` (saves metadata to AsyncStorage, password to SecureStore, and connects)
- edit a connection through the same dialog; editing the active connection applies to the live settings but waits for Reconnect, so an in-flight session is never dropped
- delete a saved connection and its SecureStore password/header secrets, except the active one
- mark the active Cloud Link row by trusted environment and machine ID, so rotating usernames do not create a temporary `Current connection` row; manual connections still compare `getConnectionScope()`

The component owns only local state (expanded row, dialog, switching row); profile state, persistence orchestration, and credential ordering live in `providers/use-connection-profiles.ts`, backed by `lib/connection-profiles.ts`; switching/reconnecting stay in the provider. The profile hook refreshes after the Cloud Link profile snapshot changes, including inactive-machine renewal while Settings remains mounted. The UI accesses these through `useConnection().connectionProfiles`.

## `components/settings/connection-profile-dialog.tsx`

### Responsibility

- collect the server address first, then password and an optional name whose
  placeholder is the hostname; Continue displays an abortable detection state
- offer a collapsible Custom headers section with key/value rows for manual
  connections (Cloudflare Access service tokens and other gateways). Values are
  masked by default, validated before probing/saving, and passed to the provider
  as a normalized map; the section is never shown for Cloud Link profiles
- hide Username for confirmed V2, show it for V1, and offer a collapsed custom
  username when credentials are needed to identify the server
- The shared TextInput clears Paper's implicit text alignment for single-line
  iOS fields to prevent wrapping. Explicit caller alignment takes precedence;
  password masking and credential values remain native and unchanged.
- validate the URL, surface probe/pair/save errors inline, and disable duplicate
  operations while busy; names default in the provider's save action
- own its form state for the lifetime of one dialog instance (mounted only while open)

Submit is a callback: the list component decides whether the values are added
as a profile plus connected, or applied to the existing profile/current
connection.
Changing the address or going Back preserves fields and invalidates obsolete
probes.
Editing uses the same form but saves without automatically reconnecting.

## `components/settings/connection-scan-flow.tsx`

### Responsibility

- own the native-only local QR setup flow, separate from the manual address form;
  opened by the Scan QR code choice in Settings and onboarding
- reuse `ConnectCameraGate` and `ConnectScanner` full-bleed without a Cloud Link
  entitlement; claiming the code stays in the provider's
  `connectionProfiles.pair`
- overlay the `opencode pair` instructions, scan progress and recovery messages
  on top of the full-screen camera rather than boxing it into a step layout like
  the Cloud Link scanner
- save and connect through the caller's submit callback with the redeemed
  credential, retaining it across a failed save/connect so Retry never re-pairs
- return to the chooser on Back or camera denial, and offer Scan again after an
  invalid/expired/unreachable code

The manual address/details surface stays in `connection-profile-dialog.tsx`; the
scan flow never renders it.

## `components/settings/service-editor.tsx`

### Responsibility

- render the full-screen add/edit form for one connector service: id (create
  only), optional name, path, target, access, enabled and strip-prefix
- mirror the connector's validation through `prepareServiceDraft`, showing
  per-field errors before spending a round trip
- offer the management revision 2 port picker (occupied and shared labels,
  disabled for the mode being edited) and the legacy path-only form with an
  update hint for older connectors
- own only local form state; every read/write goes through the provider's
  `services` domain, and Save returns through the caller's `onDone`

## `app/service.tsx`

Thin full-screen route for the service editor, registered beside `app/pair.tsx`
under the Cloud Link guard. It resolves the edited service from the provider's
services list, renders the shared `ServiceEditor`, and returns with
`router.back()`; a missing id shows a recoverable message instead of an empty
create form. No fetch or protocol logic lives here.

### `AiDefaultsSection`

Responsibility:

- show configured providers
- tap a configured provider chip to reopen login or replace its API key
- allow adding unconfigured providers
- allow removing configured provider credentials
- on OpenCode 2, list a provider's labeled accounts, mark the active account, switch accounts, remove an account, or add another account
- show models grouped by provider
- allow toggling enabled model IDs

### `NotificationsSection`

Responsibility:

- show notification readiness
- request notification permission
- deep-link into app, notification, and battery settings

### `VoiceSection`

Responsibility:

- switch between System speech and On-device voice as the active input mode
- show the active path and the wake phrase currently in use
- edit system-recognizer preference and the system wake phrase when System is active
- edit speech locale and playback preferences (auto-play, progress readback, voice, rate, working sound)
- expose a collapsed device check for microphone, recognition, and on-device capability status
- render `LocalVoiceSection` when On-device mode is selected

### `LocalVoiceSection`

Responsibility:

- show on-device readiness, base-pack and command-model status, and installed sizes
- install or remove pretrained models, and choose the wake phrase and command model
- enroll, re-enroll, or remove the local voice profile
- expose voice verification only after a profile exists
- keep the system phrase-gate fallback visible without exposing a second editable phrase in local mode

### `ResponsesSection`

Responsibility:

- edit response scope and next-action hints separately from voice input/output
- pass changes through `updateChatPreferences`; no prompt construction or provider state lives here

### `LanguageSection`

Responsibility:

- choose the app interface language or follow the system default
- persist the choice through `updateChatPreferences({ language })`; `undefined` follows the OS locale
- list the supported languages built from `SUPPORTED_LANGUAGES`

### `AppearanceSection`

`components/settings/sections/appearance-section.tsx`, rendered inside
`GeneralSection` above the slim-interface switch.

Responsibility:

- choose the app theme mode (`follow system`, `light`, `dark`)
- choose a color theme (`green` default plus blue, red, purple, pink, gray)
  from accessible preview tiles that show the themed background, surface,
  border, and accent
- persist both through `updateChatPreferences`; `hooks/use-palette.ts` and
  `hooks/use-color-scheme.ts` consume the provider-published appearance context
- expose `settings-theme-mode` and `settings-accent-<name>` test IDs

### `UpdateSection`

Responsibility:

- Advanced → Update checks group for the app update feature
- toggle update checks and pick the check period (When available, Daily, Weekly)
- read and mutate the provider-owned update preference through `useUpdates()`
- render nothing when the update module is unavailable (`supported` is false)

### `DiagnosticsSection`

Responsibility:

- show OpenCode health/version when available
- show global event stream state and whether polling fallback is active
- show MCP counts
- refresh diagnostics when the section opens and on demand; chat bootstrap no longer pays for diagnostics reads

### `PermissionsSection`

Responsibility:

- V2-only Settings view of server-persisted "always allow" rules
- show each rule's resource and action, confirm-remove one, refresh on demand
- reads and mutates provider-owned `savedPermissions` through the chat
  `approvals` value; performs no fetch itself

### `SupportSection`

Responsibility:

- open the native App Store/Play review flow through `expo-store-review` when `canRateApp()` allows it (iOS, or Android outside the foss variant)
- fall back to the Play Store listing only when Android reports that no native review action is available
- open the GitHub issue tracker for improvement feedback
- open the `getopencode.app/support/` page in the browser
- hold only URL constants, availability checks, and opening in `lib/support.ts`; no provider state

## `components/settings/provider-config-dialog.tsx`

### Responsibility

- render the full-screen provider setup flow as two steps: pick a login method, then configure it
- select the method from a dropdown; selecting dismisses the dropdown and advances to the configure step
- render type-specific controls from the normalized prompt model (text/select/number/integer/boolean/multiselect/external) with `when` conditions
- run the OAuth states on the configure step (idle, waiting for automatic completion, pairing/authorization code) without nested overlay dialogs
- hand code/automatic OAuth completion back to Settings for submission

### Prop contract

Main relevant props:

- `authValues`
- `methods`
- `oauthStage`, `oauthInstructions`, `oauthCode`
- `onAuthValueChange`
- `onBack`, `onSelectMethod`
- `onSubmit`, `onCompleteOAuth`, `onCancelOAuth`
- `selectedMethod`
- `selectedMethodIndex`
- `step`
- `visiblePrompts`

## `components/settings/mcp-section.tsx`

### Responsibility

- add local command or remote URL MCP configurations
- reuse `use-mcp-authentication.tsx` and `ProviderConfigDialog` for native integration forms, code or automatic OAuth, cancellation and stale-result guards
- show v2 OAuth only for servers that expose an `integrationID`
- show status and failure details
- connect/disconnect, enable/disable, remove, refresh, and complete remote OAuth
- refresh MCP status when the section opens instead of during every connection bootstrap
- retain only form, busy, error, and OAuth-code UI state locally

## `components/settings/extensions-section.tsx`

### Responsibility

- render the V2-only Extensions surface with General/Project scope, MCP/plugin/skill/command tabs, shared/read-only rows, and inline add/edit forms
- show the exact target config path, safety state, and last-backup recovery action
- delegate every mutation and refresh to `useExtensions()`; never fetch or persist config itself
- keep only form drafts, selected scope/tab, editing state, and local action feedback
- reuse the MCP authentication dialog and keep MCP runtime lifecycle actions in the existing MCP domain
- expose test IDs for the add/remove/edit controls used by the extension flows

## `components/settings/sections/services-section.tsx`

### Responsibility

- list the connector's exposed services from `useConnection().services`, with name, full `https://<host>:<port><path>/` URL, address (`:2053` or `:8443/app`) → target, access and enabled state
- add/replace a service through an inline form (id fixed when editing), choosing a port from the connector's `service_ports`, and remove with confirmation
- keep the path optional on management revision 2 (empty serves the port root, with the keep-prefix toggle shown only for path services) and stay on the legacy path-only form, plus a non-blocking update hint, for revision 1 or unknown older connectors
- mirror the connector's validation locally and surface the connector's own error message on rejection
- copy the service's shareable `https://<host>:<port>/` or `https://<host>:<port><path>/` link
- own only form, busy, error and feedback UI state; all reads/writes and canonical values come from the provider's services domain
- rendered only for Cloud Link connections; the provider hides it for manual connections

## `components/settings/settings-utils.ts`

### Responsibility

- response scope option definitions
- working sound option definitions
- provider marketing copy
- provider marketing copy and settings option lists

## Onboarding Components

## `app/onboarding/*.tsx`

Responsibility:

- seven connected steps: app presentation, permissions, add connection, AI & Providers, project, General Settings, ready; disconnected navigation skips AI and project
- presentation only describes the app, with Continue navigation; AI and General are optional and reuse Settings controls
- permissions, connect, AI, project and General are skippable; Skip advances without additional writes or undoing earlier choices
- General edits language, the remembered Chat model (connected only), and Steer/Append delivery (connected V2 only)
- ready summarizes connection/project plus the applicable providers, enabled models and preferences, then completes first-run setup or closes review mode
- thin controllers only; connection/project persistence and permission requests are delegated to the provider and existing helpers
- seeded from current provider state so re-running from Settings reviews rather than resets

## `components/onboarding/onboarding-step.tsx`

- shared translated step chrome: back action, step progress, title/subtitle, scrollable body, pinned footer
- `navigation.ts` defines the visible sequence; `use-onboarding-navigation.ts` derives progress and forward/back destinations from connection availability
- inaccessible server steps redirect to General; reconnects preserve provider setup, and Android Back uses the visible sequence
- Review setup appears beside the step indicator when reopened from Settings
- keeps every step visually consistent without duplicating layout

## Shared onboarding settings

- `components/settings/ai-settings-panel.tsx` composes the existing AI section, auth dialog, model/account callbacks, removal confirmation and feedback for Settings and onboarding
- `general-settings.tsx` reuses language and chat preference fields, with a searchable model select using the same `getVisibleModels` filter as Chat and Review
- `setup-summary.tsx` renders current provider values with wrapping rows and omits connection-dependent additions offline

## `components/onboarding/project-options.tsx`

- presentational project-row list shared by `ProjectPicker` and the onboarding project step
- renders an optional close control that removes a project locally; callers own empty/loading states and whether closing is offered

## `providers/onboarding-state.ts`

- `CURRENT_ONBOARDING_VERSION`, parse/serialize for the completion marker
- pure `resolveOnboardingStatus()` migration decision and the storage-backed `loadOnboardingStatus()`
- completion only; never stores connection, project, preference, or permission values

## `components/settings/use-notification-setup.ts`

- notification permission/status/platform-settings controller shared by Settings and onboarding
- requests permission only from `enable()`; `refreshStatus()` is read-only

## `components/settings/use-provider-configuration.tsx`

- provider credential dialog state machine (manual API key and OAuth, including the code callback) used by Settings
- returns the dialogs as `dialog` plus `feedback`/`setFeedback`

## `lib/voice/permissions.ts`

- `getVoiceInputPermissionAsync()` (read-only) and `requestVoiceInputPermissionAsync()` (explicit-action only) wrappers over `expo-speech-recognition`

## Shared UI Components

## `components/ui/native-select.tsx`

### Responsibility

- platform-aware select control

Behavior:

- iOS uses `ActionSheetIOS`
- Android/web use a custom modal sheet
- `searchable` forces the modal sheet on every platform and adds a text
  filter over the option labels (used by the Add provider pickers)
- the searchable modal sheet lifts its options above the soft keyboard via
  `useKeyboardHeight` (transparent `Modal`s cannot use `KeyboardAvoidingView`)
  and shrinks the sheet/list so long filtered lists stay scrollable
- the modal sheet wraps its content in `GestureHandlerRootView` and dismisses on
  a downward header drag via the shared `useSwipeDismiss` helper, matching
  `OverlaySheet`

### Prop contract

```ts
type NativeSelectProps<T extends string> = {
  disabled?: boolean
  onValueChange: (value: T) => void
  options: NativeSelectOption<T>[]
  renderTrigger: (props: {
    disabled: boolean
    open: () => void
    openState: boolean
    selectedOption?: NativeSelectOption<T>
  }) => ReactNode
  searchable?: boolean
  selectedValue?: T
  title?: string
}
```

## `components/ui/provider-icon.tsx`

### Responsibility

- render provider-specific icon assets or icon fallbacks

Known image-backed providers include:

- `openai`
- `anthropic`
- `google`
- `groq`
- `openrouter`
- `mistral`
- `xai`
- `azure`
- `github-copilot`
- `github_copilot`
- `github`

Fallback:

- `gitlab` icon
- generic `cube-outline`

## `components/ui/icon-symbol.tsx`

### Responsibility

- map SF-symbol-style names to Material Icons fallback names

Used primarily by tab icons.

## `components/haptic-tab.tsx`

### Responsibility

- custom bottom-tab button with iOS haptic feedback on press-in

## Provider And Utility Modules With UI Contracts

## `providers/opencode-provider.tsx`

### Responsibility

- thin entrypoint that mounts the provider tree with the composition unit's values

Orchestration lives in `providers/use-opencode-provider-composition.ts` and the
context wiring in `providers/opencode-provider-tree.tsx`; the entrypoint is held
to 60 lines by the architecture ratchet and only re-exports the public types.

The public UI contract is exposed through domain hooks from `providers/opencode-contexts.ts` (`useOnboarding`, `useConnection`, `useDiagnostics`, `useCapabilities`, `usePreferences`, `useProjects`, `useProjectFiles`, `useCurrentSession`, `useSessionLibrary`, `useChat`, `useApprovals`, `useConversation`, `useTerminal`, `useMcp`), each typed by its matching `*ContextValue`. There is no combined runtime context value.

## `providers/opencode-provider-types.ts`

### Responsibility

- define public provider-facing types used across UI

Most important exported contracts:

- `ConversationState`
- `ConnectionState`
- `ProviderOption`
- `ProviderAuthMethod`
- `OpencodeProject`
- the `*ContextValue` domain types

The domain values cover session lifecycle, commands, project editing/worktrees, MCP management, PTY terminal state/actions, diagnostics, global stream status, and OAuth callback completion in addition to chat state.

## `providers/opencode-provider-selectors.ts`

### Responsibility

- derive current session-scoped interactions, configured providers, transcript activity label, conversation status label, and session previews

## `providers/opencode-preferences.ts`

### Responsibility

- define the chat preference shape and defaults
- build the reasoning/response-style system prompt

## `providers/opencode-capabilities.ts`

### Responsibility

- map the resolved contract to server capability flags
- read and merge the auto-approve permission config

## `providers/opencode-model-selection.ts`

### Responsibility

- define model/agent catalog shapes
- map agents and validate stored/configured provider and model choices

## `providers/opencode-provider-utils.ts`

### Responsibility

- derive project labels
- group pending interactions by session

## `providers/services/session-service.ts`

### Responsibility

- aggregate project/session API fetches in small helpers
- expose delete, rename, fork, share/unshare, revert/unrevert, command-list, and command-execution calls

## `providers/services/capabilities-service.ts`

### Responsibility

- aggregate capability discovery and normalize provider/model/agent lists
- normalize current nested model attachment/input/tool-call/reasoning/status/limit capabilities

## `providers/services/project-service.ts`

### Responsibility

- expose file find/list/read/status, VCS read/apply, and experimental worktree operations

## `providers/services/mcp-service.ts`

### Responsibility

- expose MCP status/add/connect/disconnect/OAuth operations
- use config updates for enable/disable and removal

## `providers/services/terminal-service.ts`

### Responsibility

- expose PTY list/create/update/remove/connect-token operations
- build the ticket-authenticated, project-scoped PTY WebSocket URL

## `providers/services/diagnostics-service.ts`

### Responsibility

- load health and MCP status independently so one unavailable endpoint does not hide the other

## Regeneration Notes

To regenerate the app, the components above do not all need to be split exactly the same way.

But parity is easiest if these responsibilities remain separated:

- one chat controller component
- one transcript/content component
- one composer component
- one session header/sheet component
- one provider configuration dialog
- one platform-aware select abstraction
- one central provider/orchestrator

## UX simplification contracts

- `ChatView` creates the shared task-progress FAB and owns progress-overlay visibility. It renders the FAB beside the changes chip when visible; `PendingInteractions` renders it floating at the bottom-right otherwise and retains the detailed progress overlay. The detailed progress overlay remains available. Patch summary chips open the Files changed overlay and select their parent user turn when that message is present in the current session; otherwise the existing changes scope is retained. `TranscriptMessage` memoization includes the review callback to keep the session mapping current.
- The chat library's connection-wide group is Running & recent, with an explicit Running indicator. Deduplicated chats do not create an empty Chats section. Search-empty copy is distinct from a truly empty library.
- `components/project/files-panel.tsx` owns one FlashList for browser entries and changed-file rows, with search, breadcrumbs, status and branch/title content in its header. It renders provider-owned changed-file statuses immediately. Added/modified files use the existing reader; deleted rows explain unavailable content. Button and keyboard search share one guarded handler. Query, submitted query, loading, and failure presentation are local and reset with the connection/project key; results remain provider-owned.
- Setup has one guarded Connect & continue action through `switchConnection`. Input survives failures; connection controls and Skip are disabled while submitting. The shared Cloud Link/Manual chooser precedes the manual form.
- Approval cards separate the current resources from server-provided future `always` patterns and explain that the server controls rule duration. Missing patterns explicitly have unspecified scope. Question descriptions appear before selection, while existing custom/multiple/conditional answer handling remains intact.
- Starter examples fill the draft; the bug example appends a symptoms prompt. Terminal's empty state calls the existing creation handler and describes line-at-a-time commands.
- Icon actions and provider-credential removal expose translated action names. All supported locales carry matching keys and plural forms.
- `app/(tabs)/index.tsx` branches the pre-chat state instead of showing one passive panel: `connecting` and hydration use a spinner, a disconnected server offers `Reconnect` (error) or `Open settings` (idle) plus `Connection settings`, and a connected server without a project opens the shared `ProjectPicker` directly.
- `providers/use-transcript-read-errors.ts` owns cold transcript read failures independently of the transcript window. Non-silent failures are tagged with the current client, cleared by a successful read, and hidden after a reconnect or server switch. `TranscriptList` renders a retry card for a cold failure with no held records and never falls through to starter prompts. The retry action reuses the inbox-backed transcript read.
- `TranscriptList` exposes `Jump to latest` whenever the list is detached from the tail. New rows switch the label to `New messages`; tapping restores follow mode and saves the restored position. The control floats above the transcript without adding a list row.
- Onboarding permission cards show `Checking…` until status resolves. When the OS will no longer prompt, the enable action becomes `Open settings` via the shared notification/voice setting helpers instead of repeatedly requesting a blocked permission.
- Settings reconnect surfaces the returned `ConnectionState` in a snackbar and keeps a two-line connection summary. The reconnect button only indicates an in-flight request while it runs.
- The terminal picker marks the active PTY, shows a per-row opening spinner, repeats the target title and short ID in the close confirmation, and confirms copy with a snackbar.
- Share staging distinguishes `expired` from `discarded`; the close action is non-destructive, while the footer Discard clears the payload. Target loading, failure/retry, empty, selected, and search-empty states live in the conversation picker.
- Chat library rename auto-focuses, supports keyboard submit, offers Cancel, and disables Save for blank or in-flight titles.

Compact control labels scale up to 1.5× (tab-bar labels 1.3×) to keep fixed chrome readable at accessibility text sizes. At font scales above 1.3, the model/reasoning summary moves above the icon toolbar to preserve room for both values. The summary opens the existing model picker and thinking slider; its accessible name includes provider and reasoning. The approval icon toggles directly, the adjacent mode icon opens the agent selector, the left plus always attaches, the microphone always dictates, and the right action starts/stops conversation mode for an empty draft or sends/stops the task. Transcript text continues to use its existing scaling. Full action/model names remain exposed to accessibility.

## `components/ui/numeric-slider.tsx`

The Settings numeric slider is shared with the model picker and is backed by
`@react-native-community/slider` (Expo SDK 57 bundled version). Callers own the
value and updates; the component owns the label/value header and maps the app
palette to the native track and thumb colors. The package supplies the native
interaction and adjustable accessibility semantics. Because its web build does
not expose range semantics or arrow keys, the wrapper forwards
`aria-valuemin/max/now/text` and the previous keyboard stepping behavior.
Settings voice/volume/font controls retain their existing ranges and provider
callbacks.

The composer microphone starts direct speech-to-text dictation into the draft, preserving existing text and never submitting automatically. Empty drafts show the waveform action for conversation mode; text or attachments switch it to Send. Running tasks retain Stop. The top bar has no duplicate voice-chat action; conversation overlay and Back-stop handling remain in the existing header shell.

Composer spacing uses 8px side margins and 6px top/bottom gaps (6px sides and 4px gaps in slim mode), with 8px/4px card top/bottom padding. It does not add another bottom safe-area inset because the visible tab bar owns that inset. Keyboard avoidance and tab visibility remain unchanged.

Task progress is a 48px Paper FAB. When the changes chip is visible, the FAB sits on its right in the same row, vertically centered; symmetric space on the left keeps the chip centered. Without a changes chip, progress floats at the chat area's bottom-right. Its standard circle-slice icon fills in eight stages from the provider-owned completion ratio, becoming a checkmark when all tasks complete. Its translated accessible name contains completed/total counts. Tapping retains the existing detailed overlay. It hides while a permission/question blocks the chat. Only the chip-visible row reserves layout space; the standalone FAB is positioned absolutely on the right and reserves no transcript row or extra padding. Only blocking-card clearance remains.

Changes review dismisses the keyboard without remounting the transcript or composer. Session changes and blocking permission/question requests close review and its source picker. Switching to an empty scope keeps an already open review available; closing it hides the chip until changes exist.

The shared OverlaySheet compact option is opt-in for changes only; other overlays retain their existing height, header, and padding. Compact file rows expose expanded state to accessibility and retain filename-only patch fallback.


## Session library recovery (#64)

Library actions are serialized with an immediate operation guard; duplicate taps are ignored and the latest distinct opening is queued; results from dismissed overlays cannot replace current feedback or close a reopened overlay.

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

- `components/project/files-panel.tsx` renders sorted folders/files, breadcrumbs,
  explicit project-wide search scope, changed files, loading/empty/error states,
  and retry actions. Only the unsubmitted search input is local; listing/search
  state and actions come from the provider's `browser` member.
- `components/project/file-preview.tsx` renders the full-screen text preview,
  local edit draft, save feedback and discard confirmation. It calls the existing
  provider save action; unsupported editing is capability-gated.
- `components/project/worktree-picker.tsx` renders the owning project's worktree
  rows, selection indicators, creation form and row management menus inside the
  shared `ProjectPicker`. Forms, menu visibility and confirmations are local;
  inventory and lifecycle actions remain provider-owned.

These surfaces reuse the existing palette, theme, slim preference, inputs and
picker overlay. Projects retains its tab label and route. Chat uses the same
picker and provider selection action; Terminal follows that directory.

## App update notice

- `components/ui/update-notice.tsx`: compact, translated nonmodal ready/App Store
  banner above the tabs, transparent handoff interaction gate and failure snackbar;
  Android's available prompt and visible installation UI are owned by Google Play.
  All actions come from the provider.
- `components/ui/connection-status-banner.tsx`: compact translated transport
  notice in chat for offline, connecting, automatic reconnect, polling fallback,
  and constrained links. It never replaces a populated transcript and reads only
  provider-owned connection/diagnostics state.
- `hooks/use-update-blocker.ts`: registers open/busy local surfaces with the
  existing provider without sharing their content.
- `modules/opencode-updates`: local Expo Android Play update module and iOS
  verified-installation helper. See [app updates](app-updates.md).

## Multi-server V2 surfaces

- `chat-library.tsx`: existing row and swipe treatment in one mixed list; server chips that stay visible below long titles, an in-flight row indicator while a chat opens or is managed, search, server/project dropdowns and the sole Hide subagents toggle. Its New chat action closes the library and opens the New chat sheet. The previous compatibility view is retained in `chat-library-v1.tsx`.
- `new-chat-sheet.tsx`: mirrors `new-terminal-sheet.tsx`; confirms server, project and working directory before the provider creates and opens the chat in that workspace.
- `project-picker.tsx`: server groups, search, retry/stale state and explicit server ownership for adding/removing projects. Existing worktree controls remain.
- `new-terminal-sheet.tsx`: confirms server, project and resolved cwd before PTY creation. `retained-terminals.tsx` holds the renderer hosts; the terminal picker lists all retained owners.
- `server-context-picker.tsx`: independent Settings server/project inspection. AI & Providers, MCP, diagnostics and approvals receive that context; app preferences remain global.
- `server-approvals.tsx`: pending requests/questions, saved grants and per-server auto-approve, reusing chat permission cards and existing server actions.
- `workspace-select.tsx`: the house NativeSelect with an outlined button trigger. `OverlaySheet` bridges workspace context through the Paper portal host.

Terminal selection uses one continuous list with a server chip on each row, without empty workspace headings. With one configured workspace connection, server filters, selectors, chips and redundant scope labels are hidden across Chat, Projects, Terminal and Settings; both Settings section headings, project context and connection management remain available. Disconnected connections still count, so cached rows keep their ownership visible. Multi-server controls return automatically when a second connection is added.
