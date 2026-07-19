# State And Data Model

## State Ownership Overview

The application uses a single shared domain store implemented with React state inside `OpencodeProvider`.

State is split into six practical domains:

1. connection and environment state
2. workspace and session identity state
3. session content caches
4. capability and preference state
5. conversation mode state
6. notification tracking support state

## Connection And Environment State

Primary fields:

- `settings`
- `connection`
- `currentProjectPath`
- `serverRootPath`
- `eventStreamStatus`

Meaning:

- `settings` are user-entered connection parameters
- `connection` is the user-facing connection state machine
- `currentProjectPath` is the server's notion of current project
- `serverRootPath` is the root directory reported by the server
- `eventStreamStatus` tracks real-time subscription health independently of connection state

## Workspace And Session Identity State

Primary fields:

- `activeProjectPath`
- `serverProjects`
- `sessions`
- `sessionStatuses`
- `currentSessionId`
- `lastSessionByProject`

Meaning:

- `activeProjectPath` is the app-selected project context
- `serverProjects` are raw projects returned by the server
- `sessions` are the current project's sessions sorted newest-first
- `sessionStatuses` stores per-session runtime status from the server
- `currentSessionId` is the selected/open session
- `lastSessionByProject` persists the remembered session ID for each project path

## Session Content Caches

Primary fields:

- `messagesBySession`
- `diffsBySession`
- `todosBySession`
- `pendingPermissionsBySession`
- `pendingQuestionsBySession`

These are keyed by session ID and held in memory.

Important behavior:

- data is fetched lazily when a session is opened or refreshed
- message/diff/todo caches are updated by explicit refreshes, SSE events, and polling fallback
- permission and question entries are updated by SSE events, replies, and server list refreshes
- current-session selectors only read the active or relevant session from these maps

## Capabilities And Preferences State

Primary fields:

- `currentConfig`
- `availableProviders`
- `providerAuthMethodsById`
- `availableModels`
- `availableAgents`
- `commands`
- `workspaceFiles`
- `workspaceFileStatuses`
- `selectedWorkspaceFile`
- `vcsInfo`
- `diagnostics`
- `chatPreferences`

### `chatPreferences`

Current fields:

- `mode`
- `providerId`
- `modelId`
- `enabledModelIds`
- `providerModelSelections`
- `reasoning`
- `autoApprove`
- `autoPlayAssistantReplies`
- `preferOnDeviceRecognition`
- `resumeListeningAfterReply`
- `speechLocale`
- `speechRate`
- `speechVoiceId`
- `workingSoundEnabled`
- `workingSoundVariant`
- `workingSoundVolume`
- `responseScope`
- `includeNextActions`

These values combine true application behavior settings and output-style preferences that are sent to the model as prompt instructions.

## Conversation State

Primary fields:

- `conversationPhase`
- `conversationSessionId`
- `queuedConversationPrompt`
- `pendingConversationTurn`
- `conversationFeedback`
- `conversationLatestHeardText`

Supporting refs and timers hold important transient control state for:

- whether cancellation was requested
- whether a submission is in flight
- pending transcript waiting to be flushed
- assistant-reply baseline tracking
- resume-listening timeout
- final-result settle timeout
- listening-restart timeout

This means conversation mode is partly state-driven and partly timer/ref-driven.

## Refresh / Loading State

Primary flags:

- `isRefreshingSessions`
- `isRefreshingMessages`
- `isRefreshingDiffs`
- `isRefreshingWorkspaceCatalog`
- `isBootstrappingChat`
- `sendingState`

These flags drive loading indicators and control decisions such as whether conversation mode may start.

## Persisted Data

AsyncStorage keys are defined in `lib/storage-keys.ts`.

Persisted values:

- `opencode-mobile.settings`
- `opencode-mobile.chat-preferences`
- `opencode-mobile.active-project`
- `opencode-mobile.last-session-by-project`
- `opencode-mobile.pending-notification-sessions`

Hydration rules:

- persisted settings are merged over default settings
- persisted chat preferences are merged over defaults and current provider state
- active project path is restored if present
- last-session map is restored if present
- hydration failures are ignored and defaults are kept

The provider does not connect until hydration completes.

## Derived Data

Several important UI-facing values are derived instead of stored directly.

### Projects

Derived from `serverProjects`, `activeProjectPath`, and `currentProjectPath`.

Properties include:

- label derived from final path segment
- `source: 'server'`
- `isCurrent`
- sorted by last initialized/created time

### Active Project

Selected from derived `projects` by `activeProjectPath`.

### Current Transcript

Derived by converting `currentMessages` with `toTranscriptEntry()`.

### Current Usage

Derived from persisted assistant `step-finish` parts in `currentMessages`. Stable step IDs prevent replayed SSE events and reloads from being double counted; streaming parts are excluded. OpenCode step cost is preferred, with exact OpenCode model metadata used only as a USD fallback when reported cost is zero or absent and tokens are nonzero.

### Session Preview By ID

Derived from message history using `getHistoryPreview()`.

### Current Pending Requests

Derived by preferring:

- current session ID
- sending session ID

Only matches for the current session or sending session are shown. Permissions from unrelated sessions are not flattened into the active chat.

### Conversation Status Label

Derived from phase plus latest non-display transcript activity.

## Message And Transcript Transformation

The server returns message records shaped as:

- `info`
- `parts[]`

The app transforms them into transcript entries with:

- `id`
- `role`
- `createdAt`
- `text`
- `details[]`
- `error`

### Supported Part Mappings

Current part handling in `lib/opencode/format.ts` includes:

- `text` -> transcript text
- `reasoning` -> detail kind `reasoning`
- `tool` -> detail kind `tool`
- `patch` -> detail kind `patch`
- `file` -> detail kind `file`
- `subtask` -> detail kind `subtask`
- `step-start` / `step-finish` -> detail kind `step`
- `agent` -> detail kind `agent`
- `retry` -> detail kind `retry`
- `compaction` -> detail kind `compaction`

Display filtering then hides assistant messages that have no `text` and no `error`, while still using their details for activity summaries.

That detail is important because the transcript UI is not a raw message dump.

## OpenCode API Surface Used By The App

### Via OpenCode 1.18.3 V2 SDK Client

The app currently uses these logical server capabilities:

- path get
- project list
- project current
- config get / update
- provider list
- provider auth metadata
- auth set
- app agents
- session list
- session status
- session create
- session delete / update title / fork / share / unshare / revert / unrevert
- session messages
- session diff
- session todo
- session prompt or promptAsync
- session abort
- session summarize
- command list and session command execution
- file find/read/status and VCS info
- MCP/LSP/formatter status
- provider OAuth authorize and callback
- permission and question list/reply operations
- global event subscription

## Capability Discovery Model

Capability discovery combines four server responses:

- config
- provider list
- provider auth metadata
- agents list

From that, the app derives:

- normalized provider options
- flattened model options
- configured provider IDs
- configured model subset
- available agent options
- attachment support and input modalities per model
- tool-call and reasoning support, status, and context/output limits

Preference reconciliation then determines safe values for:

- selected mode
- selected provider
- selected model
- enabled models
- auto-approve UI state

This logic prevents stale persisted provider/model values from breaking the UI when server capabilities change.

## Notification Tracking Data

Pending completion notification storage records:

- `sessionId`
- optional `sessionTitle`
- `projectPath`
- a subset of connection settings: `serverUrl`, `username`, `password`
- `requestedAt`

This stored payload is intentionally enough for background re-checks against the server.

## Important Data Invariants

Current implementation assumes these invariants:

- an active project path is required for session-scoped activity
- a current session ID may temporarily be absent during project switches and bootstrapping
- session caches are safe to keep even when not current
- provider/model selections may need to be corrected after capability refresh
- pending permissions and questions are keyed by `sessionID` and only active/sending-session entries are surfaced
- attachment capability is checked against the selected model before send
- local attachment files larger than 10 MB are rejected before base64 encoding

## Non-Persisted But Behavioral State

Some user-visible behavior depends on transient refs not persisted anywhere:

- whether prompt submission is locked
- pending notification IDs still awaiting completion
- conversation timing windows
- transcript pagination count in chat UI
- copied-message snackbar state
- currently spoken message ID

A rewrite that only mirrors persisted values would still miss important runtime behavior.
