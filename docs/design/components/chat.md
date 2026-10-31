# Chat Components

Chat transcript, composer, cards, and attachment presentation. Back to the [component inventory](../component-inventory.md).

## Chat attachments and pending messages

`attachment-strip.tsx` renders shared 56 px square tiles in the composer,
pending stack and message cards, above each message's text. Images fill the tile;
audio and documents use icons. Filename labels remain available to assistive
technology. Composer removal is a separate 44 px action.

`attachment-preview.tsx` uses the existing overlay sheet for images, selectable
text, explicit audio playback, and inline video playback. Closing/backgrounding
stops media; temporary native files are released. PDF/Office documents use the
system share/viewer on native and browser download/open on web. Preview loading
and URI/file handling live in `shared/platform/attachments.ts`, with the existing
10 MB limit. Declared oversize and encoded data are rejected before allocation; unknown-size downloads stop at the streamed limit. Closing/backgrounding aborts pending reads, and local originals are never deleted. Image tiles and the full image preview use contain fit; the preview
fills the sheet's available height. The audio and video players live in
`shared/ui/media-preview.tsx` and are shared with project file previews.

`pending-prompts.tsx` renders provider-derived OpenCode 2 sending/waiting entries
in a bounded, scrollable stack directly above the composer. It does not own
prompt admission or delivery state. Waiting entries expose a close action that
cancels the inbox item; when the composer is empty, its text moves back into the
composer. Sending entries keep the action disabled until admission completes.

`revert-notice.tsx` renders a muted session-level notice above the pending stack
while a revert is staged. Selecting a message's revert action stops any
in-flight reply, settles it, then stages the revert immediately without a
confirmation dialog. Its close action cancels the revert.
The reverted prompt text is edited in the composer, so the notice only carries
status and the cancel affordance.

Steer/Append selection lives at the top of
Chat & responses, alongside timeline detail, chat text size, and flat
conversation. The General group contains slim interface, language and Reset
onboarding, which reopens the existing setup review without clearing settings.

## Chat Components

### `features/chat/ui/chat-view.tsx`

#### Responsibility

- main chat screen controller
- bridges provider state to presentational chat subcomponents
- owns local UI state for draft, attachments, menu visibility, speaking state, snackbars, and voice draft capture
- renders the chat approval alert for `approvals.mcpAuth` (MCP authentication required) with Open link and Dismiss actions

#### Important local state

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

#### Main responsibilities

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

#### Main child components

- `ChatHeader`
- `ChatLibrary`
- `TranscriptList`, `ChangesOverlay`, `PendingInteractions` (from `features/chat/ui/content/`)
- `PendingPrompts`, `RevertNotice`
- `ChatComposer`
- `Snackbar`

### `features/chat/ui/content/`

#### Responsibility

- `transcript-list.tsx`: render the transcript area, empty states, connection issues, and load older history on scroll-up; running progress lives on the newest activity header (including after its tools complete) and the active child row instead of a separate footer. When no activity row exists yet, it appends one transient non-interactive activity row in the same position; this is also the only activity visible at `Messages only` while a turn is working. Revert status and cancellation live in the composer notice
- `changes-overlay.tsx`: render the Files changed overlay with refresh, scope selection, and diff accordions
- `pending-interactions.tsx`: render server-owned tasks, permissions, and questions, including the compact progress view

`ChatView` renders these leaves directly and passes the values assembled by
`useChatViewController`'s `content` / `composer` / `actions` namespaces. There is
no intermediate `ChatContent` pass-through; it was removed so the prop surface is
declared once, at the leaves.

#### Behavior notes

- Chat keeps its transcript and pending cards mounted while changes are reviewed.
- transcript messages use FlashList virtualization; it starts at the bottom, follows additions only from the bottom, and preserves the visible position otherwise. Because FlashList measures progressively, the tail is re-asserted across a few frames on a session switch or data change, and the list re-applies its tail/offset when the Chat tab regains focus or the app returns to the foreground, so an Android detach or background/lock cannot leave it at the top or undrawn. A starter-prompt card is shown only for a session with no transcript content; the skeleton is shown for target bootstrap or a cold fetch with no held records. The initial pull is one newest window of up to 200 records, and each scroll-to-top loads one older 200-record batch without a backfill loop.
- The transcript renders the selected timeline detail: `Messages only` keeps message bubbles, attachments, and errors; `Reasoning` adds reasoning activity; `Everything` (the default) renders the full native timeline. Independent of that filter, a live non-expandable activity row appears while work is running and the transcript has no real activity row to carry the progress spinner. It shows `Sending…`, `Waiting for OpenCode…`, `OpenCode is working…`, or `OpenCode is retrying…`, coexists with the pending-prompt stack, and disappears when the session settles or a real activity row can show the spinner. Details are first-class activity rows (`features/chat/ui/cards/activity-group.tsx` + `features/chat/ui/cards/activity-item.tsx`): at full detail, contiguous reasoning, tool, and patch details merge into one two-level run whose content grows as streamed details arrive, and a message bubble breaks the run. The level-one header keeps the total tool-call count and lists every rendered type once, including `Thought` when reasoning is present, or `Thought · N` for a reasoning-only run; runs start collapsed, active work only shows the progress affordance, and an explicit manual toggle is the only thing that expands them. Level-two rows: thoughts expand markdown; shells show the command collapsed and a selectable, copyable code block expanded; grep stays a one-line pattern plus match count; consecutive reads collapse to one non-expandable comma-separated filename list; edit/write/patch tools render per-file diff cards with `+N −N` and an expandable unified diff. Run rows use the assistant bubble width. V1-only subtask/step/agent details and the `step-finish` usage marker are never rendered.
- A centered changes chip above the composer shows file count and green additions/red deletions for the selected scope. It hides at zero files and omits line totals for filename-only patches. Tapping opens the shared Files changed overlay with refresh, source selection, and diff accordions. Changes use a compact bottom sheet (55% of the viewport where safe areas permit), a centered file-count title, close icon, and a three-dot source button instead of separate summary/source cards.
- Changes overlay scopes: `Turn` (per-turn snapshot diff, with a picker when multiple turns have diffs), `Uncommitted`, and `Branch` (VCS working tree / default-branch diffs)
- displays starter prompts only when the selected session has no transcript content at all

### `features/chat/ui/chat-composer.tsx`

#### Responsibility

- render a rounded text area with a bottom toolbar: attachment, direct approval toggle and agent-mode icon, model/reasoning summary, dictation, and voice/send/stop
- expose supported Approvals only through a direct toolbar toggle (shield when asking, warning when auto-approving); hide it for unsupported V2 servers
- open the existing agent selector from a mode icon beside Approvals
- open the model picker from the selected model/reasoning summary, with a reasoning slider above model search
- when a classifier is available, the picker exposes the Auto-routing switch;
  the trigger reads `Auto-routing` while it is enabled, and explicit model
  selection turns it off
- dismiss the keyboard when opening selectors while preserving the parent-owned draft; model picker dismisses on Back/Escape or session/tab changes
- render optional conversation banner
- render the V2 suggestion panel for commands and context tokens, plus the shell-mode banner
- render attachments, voice status, prompt input, and action buttons
- On iOS the native multiline input grows itself between 44 and 110 px (40 to
  90 px in slim mode) and scrolls at the cap, so height never lags a layout pass
  behind the text. The native slim input retains its 40-point minimum.
  Android and web retain content-size events and the explicit measured height.

#### Prop contract

```ts
type ChatComposerProps = {
  attachments: { uri: string; mime?: string; filename?: string }[]
  availableAgents: AgentOption[]
  chatPreferences: ChatPreferences
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; confirmation?: ConversationConfirmationState; isListening: boolean; phase: string; statusLabel?: string; wakePhrase: string; wakePhraseRequired: boolean }
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

#### Important parity notes

- todos are server-owned and displayed in the chat overlay with disabled status icons; the UI has no todo mutation action
- typing `/` shows matching server commands with descriptions; typing `@` shows agents, skills, project files, and references. Selecting a row fills the draft.
- a leading `!` switches the primary action to a V2 session shell command
- there is no dedicated composer palette button; the text triggers are the only entry point
- model selection uses a searchable sheet grouped by provider; its reasoning slider shows server variants for the selected OpenCode 2 model, including a synthetic Default, and stays hidden when that model has none
- the composer trigger includes the selected variant in its accessible name when the model provides variants

### `features/chat/ui/composer-suggestions.tsx` and `use-composer-suggestions.ts`

- `chat-composer.tsx` renders the presentational suggestion rows above the input.
- `use-composer-suggestions.ts` owns only local trigger/query/file-search state; provider actions supply commands, agents, skills, references, and project file results.
- Commands and context are grouped and filtered by the active token; file search is debounced and the suggestion rows are keyboard-persistent.

### `features/chat/model/composer.ts`

- Pure trigger detection, token replacement, shell-command parsing, and final-draft mention resolution.
- Mention offsets are computed at submit time from the selected tokens, so edits and deletions cannot leave stale ranges.

### `features/ai/ui/model-picker.tsx`

#### Responsibility

- render the searchable, provider-grouped configured-model picker
- virtualize model rows with a bounded-height native `SectionList`, so opening a large catalog does not mount every model's text views at once
- pin a `Selected` and `Recent` section above the provider groups (hidden while searching)
- show an `Auto-routing` switch when a classifier is available; the switch is
  omitted when neither the on-device pack nor the OpenCode classifier can run
- selecting an explicit model disables auto-routing through the composer
- own only local modal visibility and search-query state
- return the selected `ModelOption` to the composer, which persists it through the provider
- render the shared numeric slider for the selected model's server variants
- render the trigger with the local `ControlButton`, including slim sizing for the slim-interface preference
- the transparent `Modal` sheet wraps its content in `GestureHandlerRootView` and dismisses on a downward header drag via the shared `useSwipeDismiss` helper, matching `OverlaySheet`

### `features/chat/ui/chat-header.tsx`

#### Responsibility

- top app bar with New chat and usage actions; New chat opens the server/project sheet instead of creating immediately, and voice chat starts from the composer waveform only
- active session title that opens the Chats overlay, with read-only project/worktree context below it
- compact current-session usage summary and usage breakdown sheet
- mounting point for conversation overlay

#### Prop contract

```ts
type ChatHeaderProps = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; confirmation?: ConversationConfirmationState; feedback?: string; inputPhase: ConversationInputPhase; latestHeardText?: string; level: number; phase: ConversationPhase; readbackPhase: ConversationReadbackPhase; wakePhrase: string }
  insetsTop: number
  onConfirmStopConversation: () => void
  onCreateSession: () => void
  onOpenSessionMenu: () => void
  palette: Palette
  selectedSession?: Session
  contextLimit?: number
  contextTokens?: number
  latestAssistantTurnUsage?: SessionUsage
  slim?: boolean
  usage: SessionUsage
}
```

`ChatWorkspaceContext` renders the muted project/worktree/branch line below
the title. It has no press handler, picker, or chevron; workspace selection
stays in Projects and New chat.

### `features/chat/ui/chat-workspace-context.tsx`

- renders the active project, worktree, and branch as one muted subtitle under the session title
- reads the shared checkout catalog but owns no state
- exposes no press handler, picker, or chevron; Chat cannot change the workspace from its header

`new-chat-sheet.tsx` reuses the terminal creation-sheet pattern: server
selector (only with multiple connections), project selector, resolved working
directory, and an explicit confirm action. Selection stays local until confirm;
the provider then creates and opens the session in that workspace.

### `features/sessions/ui/chat-library.tsx`

- Chats overlay with search, favorites, and swipe-left session actions
- active, favorite, and current-project rows share one FlashList scroll owner; search, filters, and New Chat stay outside the virtualized list
- "Active across projects" group above Favorites listing up to four running/recent sessions from the whole connection; listed IDs are removed from the Chat list below, and tapping one switches project and opens it through the workspace navigation action (`navigate`), not the external deep-link resolver. Project-scoped actions (rename/delete) appear only on the current-project rows
- re-seeds the cross-project snapshot when the overlay opens
- derives cross-project rows only while visible, and mounts the shared project picker only while its nested overlay is open, so a closed library does no per-publish catalog work
- keeps the Hide subagents switch alongside the Active filter
- header action opening the shared project picker overlay
- uses provider actions for switching projects, opening chats, and persistence
- owns only local search, section, swipe row, rename, and feedback state

### `shared/ui/overlay-sheet.tsx`

- shared overlay presentation for Chats, project selection, progress, diff source selection, session usage, terminal selection, and Settings categories; short overlays fit their content
- `scrollable={false}` lets embedded virtualized lists own scrolling without a nested ScrollView
- a full-screen `KeyboardAvoidingView` with `behavior="padding"` contains the sheet; the sheet and its scroll area shrink within the visible space so focused inputs (including the speech locale) stay reachable above the keyboard
- dismisses the keyboard when it opens through the shared `useDismissKeyboardOnOpen` hook, so a focused composer or search field cannot keep the keyboard covering the sheet; sheets whose content auto-focuses a field when it mounts (project rename) opt out with `dismissKeyboard={false}`
- dismisses on a downward header drag through the shared `useSwipeDismiss` helper, which owns the Pan gesture, threshold set, sheet-height measurement, and backdrop fade; the transparent `Modal` bottom sheets (model picker, select) reuse the same helper

### `features/projects/ui/workspace-breadcrumb.tsx`

- renders the one-line Projects header selector: project title at ~16pt, worktree at ~13pt, branch as quiet ~11.5pt context
- project selection is always available; the worktree selector appears only when the active project has more than one checkout
- Chat does not mount this selector; it uses `ChatWorkspaceContext` instead
- owns only sheet visibility; project/worktree selection and catalog state come from the provider
- mounts the project picker and the selection-only `WorktreeSwitcher`

### `features/projects/ui/project-picker.tsx`

- shared Chat project button and project picker overlay also used by Project's existing dropdown
- renders the connection's opened projects; a row's close control removes it locally, and adding lets the user enter a directory on the OpenCode server that the provider resolves and selects
- owns no domain state or persistence

### `features/chat/ui/chat-cards.tsx`

#### Exported components

- `PendingInteractionsCard`
- `QuestionFlow`
- `SessionDiffCard`
- `DiffCard`
- `TranscriptMessage`

#### `PendingInteractionsCard`

Responsibility:

- render session-scoped permission actions in the floating continuation area
- show the requesting session's title as `Requested by {{name}}` when the
  permission came from a subagent/nested session, so provenance is visible

#### `QuestionFlow`

- full-screen step-by-step questions; preserve local drafts across dismissal
- collect single, multiple, or custom answers and submit on the last step
- render V2 form field types, conditions, defaults, and retry errors

#### `SessionDiffCard`

Responsibility:

- render a structured diff (`FileDiff`/`VcsFileDiff`) using compact full-width rows with a left expansion chevron, filename, and green/red line totals; expanded previews wrap code within the sheet, using one old/new line-number gutter and existing collapsed-context blocks
- show a preview-unavailable line when the server reported changes without exposing patch content, and a no-line-changes line when a patch produced no renderable hunks

#### `ChangedFilesCard`

Responsibility:

- render the changed files of one turn as a plain list when the structured turn diff is absent, with a localized title and a note that diff lines are unavailable for the turn
- it is never rendered as a diff, so a filename is never presented as patch content

#### `TranscriptMessage`

Responsibility:

- render one display transcript bubble
- in flat mode (chat preference), drop the bubble chrome and side margins, render full-width rows with condensed spacing and a shared text color; the role label still distinguishes user and assistant
- with the slim-interface preference, reduce bubble padding and action-button sizes
- show copy state, optional TTS button, fork/revert actions for user messages, timestamp, markdown text, error, and summary chips
- an explicit copy button keeps copying available without capturing table-scroll gestures; taps still dismiss the keyboard

### `features/chat/ui/chat-markdown.tsx`

#### Responsibility

- render assistant/user messages with `react-native-enriched-markdown` in GitHub flavor
- code-block copy uses the same success haptic as the message bubble copy; it does not reuse the message bubble's copied pill or border, and it does not show a snackbar
- Code blocks use an opaque theme-aware background and syntax palette; user bubbles use the dark code palette because they stay dark in both themes. Blockquotes are transparent so the renderer's light blockquote default cannot bleed through in dark mode.
- Message bubbles stretch within their side margins; the renderer stretches within the bubble padding and keeps its measured content height. Avoid percentage widths inside content-sized bubbles, which can mismeasure native wrapping and height.

#### Supported formatting

- Transcript Markdown text and line spacing follow the persisted chat text-size preference.
- GitHub-flavored Markdown, including tables, ordered and unordered lists, links, emphasis, blockquotes, and fenced code blocks
- native text selection and link handling on iOS/Android, plus semantic HTML rendering on web

### `features/chat/ui/chat-overlay.tsx`

#### Responsibility

- full-screen conversation-mode overlay
- shows session title, phase, the wake phrase while armed, last heard command, the confirmation card, and stop button
- uses a three-line sine ribbon (`conversation-wave.tsx`) in the selected dark
  accent palette; the existing system microphone meter drives listening
  amplitude, while local capture and readback use phase-based motion
- pauses the ribbon on connection problems, honours reduced motion (including
  changes while open), and keeps End conversation outside scrollable content
  so large text and short screens retain access to the existing stop flow

#### Inputs

- connection status
- top inset
- latest user text
- existing conversation microphone level (0–10, clamped for presentation)
- stop handler
- conversation input phase and readback phase
- session title
- configured wake phrase
- active confirmation text, phase, errors and confirm/retry/edit/cancel actions

### `features/chat/ui/chat-diff.ts`

#### Responsibility

- parse current unified `patch` hunks into line diff previews
- collapse large unchanged context sections
- derive diff palette by line kind

#### Important behavior

- treats the common prefix and suffix as context and the middle as one changed block
- preserves context/add/remove rows with line numbers

### `features/chat/ui/chat-view-utils.ts`

#### Responsibility

- constants and tiny label helpers

Current values used by the UI:

- starter prompts list
- reasoning options list
- transcript page size = `20`
- auto-approve icon mapping

### `features/chat/ui/chat-view-styles.ts`

#### Responsibility

- centralized style sheet for most chat surfaces
- export `slimStyles`, parallel overrides applied on top of the base sheet when the slim-interface preference is on

This is important to parity because the chat layout is intentionally dense and highly composed, especially around:

- chat library
- message bubble geometry
- composer dock
- conversation banner
- task overlay
