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

These are keyed by session ID and only cached in memory.

Important behavior:

- data is fetched lazily when a session is opened or refreshed
- caches are updated both by explicit refreshes and by SSE events / polling fallback
- current-session selectors only read the active or relevant session from these maps

## Capabilities And Preferences State

Primary fields:

- `currentConfig`
- `availableProviders`
- `providerAuthMethodsById`
- `availableModels`
- `availableAgents`
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

### Session Preview By ID

Derived from message history using `getHistoryPreview()`.

### Current Pending Requests

Derived by preferring:

- current session ID
- sending session ID

If neither yields matches, all pending requests are flattened and shown.

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

### Via SDK Client

The app currently uses these logical server capabilities:

- path get
- project list
- project current
- config get / update
- provider list
- provider auth metadata
- provider OAuth authorize
- auth set
- app agents
- session list
- session status
- session create
- session messages
- session diff
- session todo
- session prompt or promptAsync
- session abort
- session summarize
- event subscribe

### Via Manual `fetch`

Some endpoints are wrapped manually in `lib/opencode/client.ts`:

- `GET /permission`
- `GET /question`
- `POST /permission/:id/reply`
- `POST /question/:id/reply`
- `POST /question/:id/reject`
- `PATCH /session/:id` for archive/unarchive

Manual requests automatically attach:

- JSON headers
- optional basic auth header
- `directory` query parameter when the client is project-scoped

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
- pending permissions/questions can exist outside the currently viewed session, so selectors must decide what to surface

## Non-Persisted But Behavioral State

Some user-visible behavior depends on transient refs not persisted anywhere:

- whether prompt submission is locked
- pending notification IDs still awaiting completion
- conversation timing windows
- transcript pagination count in chat UI
- copied-message snackbar state
- currently spoken message ID

A rewrite that only mirrors persisted values would still miss important runtime behavior.
