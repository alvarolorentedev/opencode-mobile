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
10 MB limit. Image tiles and the full image preview use contain fit; the preview
fills the sheet's available height.

`pending-prompts.tsx` renders provider-derived OpenCode 2 sending/waiting entries
in a bounded, scrollable stack directly above the composer. It does not own
prompt admission or delivery state. Steer/Append selection lives at the top of
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
- `isCreatingSession`
- `isStoppingSession`
- `expandedDiffId`
- `copiedMessageId`
- `speakingMessageId`
- `voiceFeedback`
- `sendFeedback`

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
- route fork, revert, and unrevert actions

### Main child components

- `ChatHeader`
- `ChatLibrary`
- `ChatContent`
- `ChatComposer`
- `Snackbar`

## `components/chat/chat-content.tsx`

### Responsibility

- render transcript area and changes area
- render empty states, connection issues, running indicators, and pending interactions
- render server-owned tasks in a compact progress view that opens the shared overlay
- load older transcript history when the user scrolls to the top of the list

### Prop contract

```ts
type ChatContentProps = {
  activeSession?: Session
  progressAction?: ReactNode
  progressVisible: boolean
  onCloseProgress: () => void
  changesVisible: boolean
  onCloseChanges: () => void
  awaitingUserInput: boolean
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string }
  copiedMessageId?: string
  currentActivityLabel?: string
  currentDiffs: FileDiff[]
  currentDiffScope: DiffScope
  currentPendingPermissions: PendingPermissionRequest[]
  currentPendingQuestions: PendingQuestionRequest[]
  currentTodos: Todo[]
  currentSessionId?: string
  diffCount: number
  diffDetails: DiffDetail[]
  diffTurns: DiffTurn[]
  displayTranscript: TranscriptEntry[]
  expandedDiffId?: string
  hasOlderMessages: boolean
  isLoadingOlderMessages: boolean
  onLoadOlderMessages: () => void
  isRefreshingDiffs: boolean
  isRefreshingMessages: boolean
  onCopyMessage: (entry: TranscriptEntry) => void
  onForkMessage: (messageId: string) => void
  onRevertMessage: (messageId: string) => void
  onUnrevert: () => void
  onExpandDiff: (id?: string) => void
  onRefresh: () => void
  onRefreshDiffs: () => void
  onSelectDiffScope: (scope: DiffScope) => void
  onSelectDiffMessage: (messageId: string) => void
  selectedDiffMessageId?: string
  onRejectQuestion: (requestId: string) => void
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => void
  onReplyToQuestion: (requestId: string, answers: string[][]) => void
  onSelectStarterPrompt: (prompt: string) => void // fills draft, never sends
  onReviewChanges: (messageId: string) => void // resolves the current session's parent user turn
  onToggleSpeak: (entry: TranscriptEntry) => void
  palette: Palette
  pendingInteractions: number
  running: boolean
  speakingMessageId?: string
  status?: SessionStatus
}
```

### Behavior notes

- Chat keeps its transcript and pending cards mounted while changes are reviewed.
- transcript messages use FlashList virtualization; it starts at the bottom, follows additions only from the bottom, and preserves the visible position otherwise
- A centered changes chip above the composer shows file count and green additions/red deletions for the selected scope. It hides at zero files and omits line totals for filename-only patches. Tapping opens the shared Files changed overlay with refresh, source selection, and diff accordions. Changes use a compact bottom sheet (55% of the viewport where safe areas permit), a centered file-count title, close icon, and a three-dot source button instead of separate summary/source cards.
- Changes overlay scopes: `Turn` (per-turn snapshot diff, with a picker when multiple turns have diffs), `Uncommitted`, and `Branch` (VCS working tree / default-branch diffs)
- displays starter prompts when there are no display transcript messages

## `components/chat/chat-composer.tsx`

### Responsibility

- render a rounded text area with a bottom toolbar: attachment, direct approval toggle and agent-mode icon, model/reasoning summary, dictation, and voice/send/stop
- expose supported Approvals only through a direct toolbar toggle (shield when asking, warning when auto-approving); hide it for unsupported V2 servers
- open the existing agent selector from a mode icon beside Approvals
- open the model picker from the selected model/reasoning summary, with a reasoning slider above model search
- dismiss the keyboard when opening selectors while preserving the parent-owned draft; model picker dismisses on Back/Escape or session/tab changes
- render optional conversation banner
- render attachments, voice status, prompt input, and action buttons
- On iOS, an invisible, accessibility-hidden native Text measures the draft at
  the input's width and typography because fixed-height Fabric inputs can miss
  content-size events. Trailing blank lines are included. The input grows from
  44 to 110 px (36 to 90 px in slim mode), scrolls at the cap, and shrinks when
  text is removed or cleared. Android and web retain content-size events.

### Prop contract

```ts
type ChatComposerProps = {
  attachments: { uri: string; mime?: string; filename?: string }[]
  availableAgents: AgentOption[]
  chatPreferences: ChatPreferences
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; isListening: boolean; phase: string; statusLabel?: string }
  draft: string
  isCreatingSession: boolean
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
  onCommandSelect: (command: string) => void
}
```

### Important parity notes

- todos are server-owned and displayed in the chat overlay with disabled status icons; the UI has no todo mutation action
- typing `/` shows up to six matching server commands; selecting one fills the draft
- model selection uses a searchable sheet grouped by provider; the composer trigger displays the selected model and reasoning; its accessible name includes model, provider, and reasoning

## `components/chat/model-picker.tsx`

### Responsibility

- render the searchable, provider-grouped configured-model picker
- virtualize model rows with a bounded-height native `SectionList`, so opening a large catalog does not mount every model's text views at once
- pin a `Selected` and `Recent` section above the provider groups (hidden while searching)
- own only local modal visibility and search-query state
- return the selected `ModelOption` to the composer, which persists it through the provider
- optionally render the shared numeric slider for discrete Low/Default/High reasoning above model search, using provider-owned preferences

## `components/chat/chat-header.tsx`

### Responsibility

- top app bar with New Chat and usage actions; voice chat starts from the composer waveform only
- active session and workspace title that opens the Chats overlay
- compact current-session usage summary and usage breakdown sheet
- mounting point for conversation overlay

### Prop contract

```ts
type ChatHeaderProps = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; latestHeardText?: string; phase: ConversationPhase }
  insetsTop: number
  isCreatingSession: boolean
  onConfirmStopConversation: () => void
  onCreateSession: () => void
  onOpenLibrary: () => void
  palette: Palette
  selectedSession?: Session
  activeProjectLabel?: string
}
```

## `components/chat/chat-library.tsx`

- Chats overlay with search, favorites, archived sessions, and swipe-left session actions
- active, favorite, current-workspace, and archived rows share one FlashList scroll owner; search, filters, and New Chat stay outside the virtualized list
- "Active across workspaces" group above Favorites listing up to four running/recent sessions from the whole connection; listed IDs are removed from the Chat list below, and tapping one switches project and opens it through `openSessionInProject`. Project-scoped actions (rename/share/archive/delete) appear only on the current-workspace rows
- re-seeds the cross-workspace snapshot when the overlay opens
- keeps the Hide subagents switch alongside the Active and Archived filters
- header action opening the shared workspace picker overlay
- uses provider actions for switching workspaces, opening chats, and persistence
- owns only local search, section, swipe row, rename, and feedback state

## `components/ui/overlay-sheet.tsx`

- shared overlay presentation for Chats, workspace selection, progress, diff source selection, session usage, terminal selection, and Settings categories; short overlays fit their content
- `scrollable={false}` lets embedded virtualized lists own scrolling without a nested ScrollView
- a full-screen `KeyboardAvoidingView` with `behavior="padding"` contains the sheet; the sheet and its scroll area shrink within the visible space so focused inputs (including the speech locale) stay reachable above the keyboard

## `components/ui/workspace-picker.tsx`

- shared Chat workspace button and project picker overlay also used by Workspace's existing dropdown
- lets the user enter a directory on the OpenCode server; the provider resolves and selects it
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

### `DiffCard`

Responsibility:

- render filename-only patch transcript details when structured diff data is absent

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
- Message bubbles stretch within their side margins; the renderer stretches within the bubble padding and keeps its measured content height. Avoid percentage widths inside content-sized bubbles, which can mismeasure native wrapping and height.

### Supported formatting

- Transcript Markdown text and line spacing follow the persisted chat text-size preference.
- GitHub-flavored Markdown, including tables, ordered and unordered lists, links, emphasis, blockquotes, and fenced code blocks
- native text selection and link handling on iOS/Android, plus semantic HTML rendering on web

## `components/chat/chat-overlay.tsx`

### Responsibility

- full-screen conversation-mode overlay
- shows session title, phase, last heard text, and stop button

### Inputs

- connection status
- top inset
- latest user text
- stop handler
- conversation phase
- session title

## `components/chat/chat-controls.tsx`

### Exported components

- `SelectControl`
- `ControlButton`
- `TopTab`

### Responsibility

- small reusable controls for the chat toolbar and Workspace header
- accept a `slim` prop that shrinks control height, icon size, and label size for the slim-interface preference

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

## `app/(tabs)/workspace.tsx`

### Responsibility

- wire project selection to the provider
- wire the provider browser, preview, and shared workspace picker
- combine folder/search, file status, and workspace catalog refresh
- keep picker/preview visibility and screen feedback local

### Presentation

- keeps its active-project title, path, and dropdown trigger in the header; the dropdown opens the shared workspace picker overlay
- the shared picker can add a server directory as a workspace
- provides one workspace refresh action
- shows files directly with breadcrumbs and scoped search; worktree controls live in the shared workspace picker
- opens file viewing and editing in a focused full-screen surface

## `app/(tabs)/settings.tsx`

### Responsibility

- wire connection, diagnostics, provider, notification, and voice sections to the provider
- open provider OAuth URLs through an app-returnable auth session and capture a
  redirect code back into the app
- poll for automatic OAuth completion and show headless/device-code pairing
  instructions, then submit code-based OAuth callbacks
- wire MCP add/connect/disconnect/enable/disable and OAuth actions to `McpSection`
- declare every category once in a `SettingsSection` registry (`icon`, `title`,
  `summary`, `onPress`, `render`); the row list and the overlay both derive from
  it, so adding a category is a single entry plus its presentational component

### Presentation

- shows compact settings rows in one group and opens one category at a time
- places `Subscription` immediately after Connection when Cloud Link is enabled;
  its summary reflects initialization or verified access status
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

## Settings Components

`connection-method-chooser.tsx` renders the shared Cloud Link/Manual choices and
a learn-more link. `connection-setup-form.tsx` composes the chooser and existing
manual profile form for onboarding and returning from pairing.
`connect-camera-gate.tsx` resolves native camera permission before the pairing
surface renders and cancels pairing on denial; documented web never uses the
camera. `connect-pairing.tsx` composes the full-screen scanner, an appbar
options action that hosts the pairing-link alternative and machine management,
plus shared subscription and error overlays. Environment routing belongs to the
provider and purchase service; no URL editor is rendered. `connect-scanner.tsx`
owns camera presentation/lifecycle and the viewfinder; it previews only once
permission is granted and never pairs without an entitlement.
`connect-subscription.tsx` renders native offers and explicit purchase/Restore.
`sections/subscription-section.tsx` renders the Cloud Link access summary,
Subscription actions (native store management, offers when inactive, one Restore
row), and a Machines shortcut to the existing management route. It uses the
shared Settings overlay and provider state; it never opens the camera or starts
a purchase merely by opening the section.
`connect-panel.tsx` renders the separate machine/profile management view. `app/pair.tsx` ingests links and navigates only; deep links skip the camera gate.
Domain state/actions come from `useConnection().connectSetup`; see [Cloud Link](connect.md).

## `components/settings/settings-sections.tsx`

### Exported sections

- `EditorSection`
- `GeneralSection`
- `ConnectionSection`
- `SubscriptionSection`
- `AiDefaultsSection`
- `NotificationsSection`
- `VoiceSection`
- `LanguageSection`
- `DiagnosticsSection`
- `SupportSection`

### `ConnectionSection`

Responsibility:

- show connection state card
- show the current connection message or error hint from provider state
- render the saved-connection list (`ConnectionProfiles`)

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
- delete a saved connection and its SecureStore password, except the active one
- mark the active row by comparing `getConnectionScope()` of the profile and the current settings

The component owns only local state (expanded row, dialog, switching row); profile state, persistence orchestration, and credential ordering live in `providers/use-connection-profiles.ts`, backed by `lib/connection-profiles.ts`; switching/reconnecting stay in the provider. The UI accesses these through `useConnection().connectionProfiles`.

## `components/settings/connection-profile-dialog.tsx`

### Responsibility

- collect the server address first, then password and an optional name whose
  placeholder is the hostname; Continue displays an abortable detection state
- hide Username for confirmed V2, show it for V1, and offer a collapsed custom
  username when credentials are needed to identify the server
- reuse `ConnectCameraGate` and `ConnectScanner` for native-only local QR setup,
  without a Cloud Link entitlement; scanning automatically saves and connects
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
probes. Successful redemption retains its token through save/connect retries.
Editing uses the same form but saves without automatically reconnecting.

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

- edit speech input/output preferences
- edit response style settings that become system prompt hints
- select working sound and speech voice
- adjust speech rate and working-sound volume with touch sliders

### `LanguageSection`

Responsibility:

- choose the app interface language or follow the system default
- persist the choice through `updateChatPreferences({ language })`; `undefined` follows the OS locale
- list the supported languages built from `SUPPORTED_LANGUAGES`

### `DiagnosticsSection`

Responsibility:

- show OpenCode health/version when available
- show global event stream state and whether polling fallback is active
- show MCP, LSP, and formatter counts
- refresh diagnostics on demand

### `PermissionsSection`

Responsibility:

- V2-only Settings view of server-persisted "always allow" rules
- show each rule's resource and action, confirm-remove one, refresh on demand
- reads and mutates provider-owned `savedPermissions` through the chat
  `approvals` value; performs no fetch itself

### `SupportSection`

Responsibility:

- open the Play Store listing to rate the app, but only when a Play Store build exists (`hasPlayStoreRating()`: Android and not the foss variant)
- open the GitHub issue tracker for improvement feedback
- open the `getopencode.app/support/` page in the browser
- hold only URL constants/opening in `lib/support.ts`; no provider state

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
- show status and failure details
- connect/disconnect, enable/disable, remove, refresh, and complete remote OAuth
- retain only form, busy, error, and OAuth-code UI state locally

## `components/settings/settings-utils.ts`

### Responsibility

- response scope option definitions
- working sound option definitions
- provider marketing copy
- provider marketing copy and settings option lists

## Onboarding Components

## `app/onboarding/*.tsx`

Responsibility:

- the five first-run setup steps: app presentation, permissions, add connection, workspace, ready
- presentation only describes the app, with Continue navigation; preferences and provider setup live in Settings
- permissions, connect and workspace are skippable; skipping advances one step without persisting anything
- ready summarizes only the connection and workspace, then completes first-run setup or closes review mode
- thin controllers only; connection/workspace persistence and permission requests are delegated to the provider and existing helpers
- seeded from current provider state so re-running from Settings reviews rather than resets

## `components/onboarding/onboarding-step.tsx`

- shared translated step chrome: back action, step progress, title/subtitle, scrollable body, pinned footer
- Review setup appears beside the step indicator when reopened from Settings
- keeps every step visually consistent without duplicating layout

## `components/onboarding/project-options.tsx`

- presentational project-row list shared by `WorkspacePicker` and the onboarding workspace step
- callers own empty/loading states

## `providers/onboarding-state.ts`

- `CURRENT_ONBOARDING_VERSION`, parse/serialize for the completion marker
- pure `resolveOnboardingStatus()` migration decision and the storage-backed `loadOnboardingStatus()`
- completion only; never stores connection, workspace, preference, or permission values

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

- central domain controller for almost all app behavior

The public UI contract is exposed through domain hooks from `providers/opencode-contexts.ts` (`useOnboarding`, `useConnection`, `useDiagnostics`, `useCapabilities`, `usePreferences`, `useProjects`, `useWorkspaceFiles`, `useCurrentSession`, `useSessionLibrary`, `useChat`, `useApprovals`, `useConversation`, `useTerminal`, `useMcp`), each typed by its matching `*ContextValue`. `OpencodeContextValue` is their documented union.

## `providers/opencode-provider-types.ts`

### Responsibility

- define public provider-facing types used across UI

Most important exported contracts:

- `ConversationState`
- `ConnectionState`
- `ProviderOption`
- `ProviderAuthMethod`
- `OpencodeProject`
- the `*ContextValue` domain types and their union `OpencodeContextValue`

The domain values cover active/archived session lifecycle, commands, workspace editing/worktrees, MCP management, PTY terminal state/actions, diagnostics, global stream status, and OAuth callback completion in addition to chat state.

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

- aggregate workspace/session API fetches in small helpers
- expose delete, rename, fork, share/unshare, revert/unrevert, command-list, and command-execution calls

## `providers/services/capabilities-service.ts`

### Responsibility

- aggregate capability discovery and normalize provider/model/agent lists
- normalize current nested model attachment/input/tool-call/reasoning/status/limit capabilities

## `providers/services/workspace-service.ts`

### Responsibility

- expose file find/list/read/status, VCS read/apply, and experimental worktree operations

## `providers/services/mcp-service.ts`

### Responsibility

- expose MCP status/add/connect/disconnect/OAuth operations
- use config updates for enable/disable and removal

## `providers/services/terminal-service.ts`

### Responsibility

- expose PTY shell/list/create/get/update/remove/connect-token operations
- build the ticket-authenticated, project-scoped PTY WebSocket URL

## `providers/services/diagnostics-service.ts`

### Responsibility

- load health, MCP, LSP, and formatter status independently so one unavailable endpoint does not hide the others

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

- `ChatView` creates the shared task-progress FAB and owns progress-overlay visibility. It renders the FAB beside the changes chip when visible; `ChatContent` renders it floating at the bottom-right otherwise and retains the detailed progress overlay. The detailed progress overlay remains available. Patch summary chips open the Files changed overlay and select their parent user turn when that message is present in the current session; otherwise the existing changes scope is retained. `TranscriptMessage` memoization includes the review callback to keep the session mapping current.
- The chat library's connection-wide group is Running & recent, with an explicit Running indicator. Deduplicated chats do not create an empty Chats section. Search-empty copy is distinct from a truly empty library.
- `components/workspace/files-panel.tsx` renders provider-owned changed-file statuses immediately. Added/modified files use the existing reader; deleted rows explain unavailable content. Button and keyboard search share one guarded handler. Query, submitted query, loading, and failure presentation are local and reset with the connection/workspace key; results remain provider-owned.
- Setup has one guarded Connect & continue action through `switchConnection`. Input survives failures; connection controls and Skip are disabled while submitting. The shared Cloud Link/Manual chooser precedes the manual form.
- Approval cards separate the current resources from server-provided future `always` patterns and explain that the server controls rule duration. Missing patterns explicitly have unspecified scope. Question descriptions appear before selection, while existing custom/multiple/conditional answer handling remains intact.
- Starter examples fill the draft; the bug example appends a symptoms prompt. Terminal's empty state calls the existing creation handler and describes line-at-a-time commands.
- Icon actions and provider-credential removal expose translated action names. All supported locales carry matching keys and plural forms.

Compact control labels scale up to 1.5× (tab-bar labels 1.3×) to keep fixed chrome readable at accessibility text sizes. At font scales above 1.3, the model/reasoning summary moves above the icon toolbar to preserve room for both values. The summary opens the existing model picker and thinking slider; its accessible name includes provider and reasoning. The approval icon toggles directly, the adjacent mode icon opens the agent selector, the left plus always attaches, the microphone always dictates, and the right action starts/stops conversation mode for an empty draft or sends/stops the task. Transcript text continues to use its existing scaling. Full action/model names remain exposed to accessibility.

## `components/ui/numeric-slider.tsx`

The existing Settings numeric slider is shared with the model picker. It owns measured track width only; callers own the value and updates. It supports a 44px pointer target, discrete steps, Home/End/arrow keys on web, and increment/decrement accessibility actions on native. Settings voice/volume/font controls retain their existing ranges and provider callbacks.

The composer microphone starts direct speech-to-text dictation into the draft, preserving existing text and never submitting automatically. Empty drafts show the waveform action for conversation mode; text or attachments switch it to Send. Running tasks retain Stop. The top bar has no duplicate voice-chat action; conversation overlay and Back-stop handling remain in the existing header shell.

Composer spacing uses 8px side margins and 6px top/bottom gaps (6px sides and 4px gaps in slim mode), with 8px/4px card top/bottom padding. It does not add another bottom safe-area inset because the visible tab bar owns that inset. Keyboard avoidance and tab visibility remain unchanged.

Task progress is a 48px Paper FAB. When the changes chip is visible, the FAB sits on its right in the same row, vertically centered; symmetric space on the left keeps the chip centered. Without a changes chip, progress floats at the chat area's bottom-right. Its standard circle-slice icon fills in eight stages from the provider-owned completion ratio, becoming a checkmark when all tasks complete. Its translated accessible name contains completed/total counts. Tapping retains the existing detailed overlay. It hides while a permission/question blocks the chat. Only the chip-visible row reserves layout space; the standalone FAB is positioned absolutely on the right and reserves no transcript row or extra padding. Only blocking-card clearance remains.

Changes review dismisses the keyboard without remounting the transcript or composer. Session changes and blocking permission/question requests close review and its source picker. Switching to an empty scope keeps an already open review available; closing it hides the chip until changes exist.

The shared OverlaySheet compact option is opt-in for changes only; other overlays retain their existing height, header, and padding. Compact file rows expose expanded state to accessibility and retain filename-only patch fallback.


## Session library recovery (#64)

Archived Chat Library cards are accessible buttons that restore and open through the provider. The swipe Restore action remains available and passes the row directory. Library actions are serialized with an immediate operation guard; duplicate taps are ignored and the latest distinct opening is queued; results from dismissed overlays cannot replace current feedback or close a reopened overlay.

## Terminal presentation

`terminal-screen.tsx` composes the existing picker, header, creation and termination
actions, reconnect errors, and padding keyboard layout. `terminal-view.tsx`
registers renderers with the provider and adapts Expo DOM acknowledgements,
clipboard operations, and multiline/control-character paste confirmation.

`terminal-dom.tsx` retains xterm instances inside one DOM surface, receives
imperative output batches, reports fit dimensions, and sends ordered input.
`terminal-accessory.tsx` renders Esc/Tab/Ctrl/Alt/Shift/arrows/Fn plus F1–F12,
Home/End/PageUp/PageDown/Insert/Delete/Paste. A modifier tap arms it once, a
double tap locks it, and another tap clears it. Terminal/tab changes clear modifiers.
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

## Workspace file browser components

- `components/workspace/files-panel.tsx` renders sorted folders/files, breadcrumbs,
  explicit workspace-wide search scope, changed files, loading/empty/error states,
  and retry actions. Only the unsubmitted search input is local; listing/search
  state and actions come from the provider's `browser` member.
- `components/workspace/file-preview.tsx` renders the full-screen text preview,
  local edit draft, save feedback and discard confirmation. It calls the existing
  provider save action; unsupported editing is capability-gated.
- `components/workspace/worktree-picker.tsx` renders the owning project's worktree
  rows, selection indicators, creation form and row management menus inside the
  shared `WorkspacePicker`. Forms, menu visibility and confirmations are local;
  inventory and lifecycle actions remain provider-owned.

These surfaces reuse the existing palette, theme, slim preference, inputs and
picker overlay. Workspace retains its tab label and route. Chat uses the same
picker and provider selection action; Terminal follows that directory.

## App update notice

- `components/ui/update-notice.tsx`: themed, translated banner, failure snackbar
  and interaction gate; all actions come from the provider.
- `hooks/use-update-blocker.ts`: registers open/busy local surfaces with the
  existing provider without sharing their content.
- `modules/opencode-updates`: local Expo Android Play update module and iOS
  verified-installation helper. See [app updates](app-updates.md).
