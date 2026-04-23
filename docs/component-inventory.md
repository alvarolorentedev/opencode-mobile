# Component Inventory

## Purpose

This document inventories the current UI and support components, their responsibilities, and their prop contracts where relevant to parity.

The goal is to make it possible to rebuild the UI tree without having to rediscover each component's role from source.

## Chat Components

## `components/chat/chat-view.tsx`

### Responsibility

- main chat screen controller
- bridges provider state to presentational chat subcomponents
- owns local UI state for draft, attachments, pagination, menu visibility, speaking state, snackbars, and voice draft capture

### Important local state

- `draft`
- `attachments`
- `activeTab`
- `sessionMenuVisible`
- `isUpdatingAutoApprove`
- `isCreatingSession`
- `isStoppingSession`
- `visibleTranscriptCount`
- `expandedDiffId`
- `copiedMessageId`
- `speakingMessageId`
- `voiceFeedback`
- `sendFeedback`

### Main responsibilities

- determine whether current session is running
- filter transcript into display entries
- paginate transcript
- coordinate copy-to-clipboard and TTS playback
- coordinate draft speech recognition
- attach files through document picker
- route prompt send / abort actions
- open/create sessions and toggle conversation mode

### Main child components

- `ChatHeader`
- `ChatContent`
- `ChatComposer`
- `Snackbar`

## `components/chat/chat-content.tsx`

### Responsibility

- render transcript area and changes area
- render empty states, connection issues, running indicators, and pending interactions

### Prop contract

```ts
type ChatContentProps = {
  activeSession?: Session
  activeTab: 'session' | 'changes'
  awaitingUserInput: boolean
  connection: { status: 'idle' | 'connecting' | 'connected' | 'error'; message: string }
  copiedMessageId?: string
  currentActivityLabel?: string
  currentDiffs: FileDiff[]
  currentPendingPermissions: PendingPermissionRequest[]
  currentPendingQuestions: PendingQuestionRequest[]
  currentSessionId?: string
  diffDetails: DiffDetail[]
  displayTranscript: TranscriptEntry[]
  expandedDiffId?: string
  hasMoreTranscript: boolean
  isRefreshingDiffs: boolean
  isRefreshingMessages: boolean
  onCopyMessage: (entry: TranscriptEntry) => void
  onExpandDiff: (id?: string) => void
  onLoadEarlier: () => void
  onRefresh: () => void
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => void
  onReplyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => void
  onRejectQuestion: (requestId: string) => void
  onSendStarterPrompt: (prompt: string) => void
  onToggleSpeak: (entry: TranscriptEntry) => void
  palette: Palette
  pendingInteractions: number
  running: boolean
  scrollRef: RefObject<ScrollView | null>
  speakingMessageId?: string
  status?: SessionStatus
  visibleTranscript: TranscriptEntry[]
}
```

### Behavior notes

- `session` tab shows transcript and pending cards
- `changes` tab shows diff accordions
- displays starter prompts when there are no display transcript messages

## `components/chat/chat-composer.tsx`

### Responsibility

- render controls for agent/model/reasoning selection
- render auto-approve toggle
- render optional conversation banner
- render optional todo summary card
- render attachments, voice status, prompt input, and action buttons

### Prop contract

```ts
type ChatComposerProps = {
  attachments: { uri: string; mime?: string; filename?: string }[]
  availableAgents: AgentOption[]
  chatPreferences: ChatPreferences
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; isListening: boolean; phase: string; statusLabel?: string }
  draft: string
  insetsBottom: number
  isCreatingSession: boolean
  isSpeechInputAvailable: boolean
  isSpeechInputListening: boolean
  isStoppingSession: boolean
  isUpdatingAutoApprove: boolean
  onAttach: () => void
  onDraftChange: (value: string) => void
  onRemoveAttachment: (index: number) => void
  onSend: () => void
  onToggleAutoApprove: () => void
  onToggleRecording: () => void
  palette: Palette
  selectedAgentLabel: string
  showSendAction: boolean
  currentSessionId?: string
  visibleModels: ModelOption[]
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void
  currentTodos?: any[]
}
```

### Important parity note

- todo checkbox presses only update local `checkedIds`, not server state

## `components/chat/chat-header.tsx`

### Responsibility

- top app bar
- session picker sheet
- mounting point for conversation overlay

### Prop contract

```ts
type ChatHeaderProps = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  conversation: { active: boolean; latestHeardText?: string; phase: ConversationPhase }
  insetsTop: number
  isCreatingSession: boolean
  onCloseMenu: () => void
  onConfirmStopConversation: () => void
  onCreateSession: () => void
  onOpenSession: (sessionId: string) => void
  onOpenSessionMenu: () => void
  onToggleConversationMode: () => void
  palette: Palette
  selectedSession?: Session
  sessionMenuVisible: boolean
  sessions: Session[]
  currentSessionId?: string
}
```

## `components/chat/chat-cards.tsx`

### Exported components

- `PendingInteractionsCard`
- `SessionDiffCard`
- `DiffCard`
- `TranscriptMessage`

### `PendingInteractionsCard`

Responsibility:

- render permission and question cards in a single continuation-blocked card

### `SessionDiffCard`

Responsibility:

- render structured diff accordion using generated line-level diff preview

### `DiffCard`

Responsibility:

- render fallback patch/file transcript details when structured diff data is absent

### `TranscriptMessage`

Responsibility:

- render one display transcript bubble
- show copy state, optional TTS button, timestamp, markdown text, error, and summary chips

## `components/chat/chat-markdown.tsx`

### Responsibility

- render a small markdown subset for assistant/user messages

### Supported formatting

- headings `#` to `###`
- bullets using `-` or `*`
- fenced code blocks
- inline code
- bold text

### Important limitation

- this is not full markdown compatibility

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

- small reusable controls for chat toolbar and tab strip

## `components/chat/chat-diff.ts`

### Responsibility

- generate line diff data from `before` and `after`
- collapse large unchanged context sections
- derive diff palette by line kind

### Important behavior

- uses a longest-common-subsequence style table to build diff lines
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

This is important to parity because the chat layout is intentionally dense and highly composed, especially around:

- session picker sheet
- message bubble geometry
- composer dock
- conversation banner
- todo card

## Settings Components

## `components/settings/settings-sections.tsx`

### Exported sections

- `ConnectionSection`
- `AiDefaultsSection`
- `NotificationsSection`
- `VoiceSection`

### `ConnectionSection`

Responsibility:

- edit server URL, username, password
- show connection state card
- trigger reconnect

### `AiDefaultsSection`

Responsibility:

- show configured providers
- allow adding unconfigured providers
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

## `components/settings/provider-config-dialog.tsx`

### Responsibility

- render provider configuration modal
- support multi-method auth selection
- render prompt fields from auth metadata
- support OAuth and API/manual flows

### Prop contract

Main relevant props:

- `authMethods`
- `authValues`
- `effectiveAuthMethods`
- `onAuthValueChange`
- `onMethodChange`
- `onSubmit`
- `selectedMethod`
- `selectedMethodIndex`
- `selectedProviderLabel`
- `visiblePrompts`

## `components/settings/settings-utils.ts`

### Responsibility

- response scope option definitions
- working sound option definitions
- provider marketing copy
- generic API fallback rule for providers without auth metadata

## Shared UI Components

## `components/ui/native-select.tsx`

### Responsibility

- platform-aware select control

Behavior:

- iOS uses `ActionSheetIOS`
- Android/web use a custom modal sheet

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

The effective public UI contract is exposed through `useOpencode()` and typed by `OpencodeContextValue`.

## `providers/opencode-provider-types.ts`

### Responsibility

- define public provider-facing types used across UI

Most important exported contracts:

- `ConversationState`
- `ConnectionState`
- `ProviderOption`
- `ProviderAuthMethod`
- `OpencodeProject`
- `OpencodeContextValue`

## `providers/opencode-provider-selectors.ts`

### Responsibility

- derive current pending requests, configured providers, transcript activity label, conversation status label, and session previews

## `providers/opencode-provider-utils.ts`

### Responsibility

- define preference defaults
- map agents/models/providers
- generate system prompt hints
- merge permission config

## `providers/services/session-service.ts`

### Responsibility

- aggregate workspace/session API fetches in small helpers

## `providers/services/capabilities-service.ts`

### Responsibility

- aggregate capability discovery and normalize provider/model/agent lists

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
