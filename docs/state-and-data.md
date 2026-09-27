# State And Data Model

## State Ownership Overview

The application uses a single shared domain store implemented with React state inside `OpencodeProvider`.

State is split into seven practical domains:

1. connection and environment state
2. workspace and session identity state
3. session content caches
4. capability and preference state
5. conversation mode state
6. notification tracking support state
7. terminal state

## Connection And Environment State

Primary fields:

- `settings`
- `connection`
- `serverContract`
- `currentProjectPath`
- `serverRootPath`
- `eventStreamStatus`

Meaning:

- `settings` are user-entered connection parameters
- `connection` is the user-facing connection state machine
- `serverContract` is the resolved server API contract (`v1` or `v2`), set by probing during `connect()` and used to select the client implementation
- `currentProjectPath` is the server's notion of current project
- `serverRootPath` is the root directory reported by the server
- `eventStreamStatus` tracks real-time subscription health independently of connection state

## Workspace And Session Identity State

Primary fields:

- `activeProjectPath`
- `serverProjects`
- `sessions`
- `archivedSessions`
- `sessionStatuses`
- `currentSessionId`
- `lastSessionByConnection`

Meaning:

- `activeProjectPath` is the app-selected project context
- `serverProjects` are raw projects returned by the server
- `sessions` are the current project's sessions sorted newest-first
- `sessionStatuses` stores per-session runtime status from the server
- `currentSessionId` is the selected/open session
- `lastSessionByConnection` persists the remembered session ID per connection scope and project path, so the same path on two servers remembers different sessions
- `archivedSessions` is the experimental cross-project archived-session result, sorted newest-first

## Session Content Caches

Primary fields:

- `messagesBySession`
- `diffsBySession`
- `todosBySession`
- `pendingPermissionsBySession`
- `pendingQuestionsBySession`

These are keyed by session ID and held in memory.

Diff scope state:

- `diffScopeBySession` records the selected Files Changed scope (`turn`, `uncommitted`, `branch`) per session; it defaults to `turn`
- `selectedDiffMessageBySession` records which user turn the `turn` scope is pinned to; it is cleared when a new prompt is sent
- `vcsDiffsByScope` caches the workspace-scoped `uncommitted`/`branch` diffs, which are not keyed by session
- `currentDiffs` resolves to the active scope's diff; VCS scopes have no SSE event, so they refresh on scope change, pull-to-refresh, or a workspace file save while active

Important behavior:

- data is fetched lazily when a session is opened or refreshed
- message/diff/todo caches are updated by explicit refreshes, SSE events, and polling fallback
- an incoming `session.diff` event only overwrites the turn diff when the surface is not pinned to an earlier turn
- on V2 the server has no todo endpoint, so `currentTodos` falls back to the plan derived from the transcript's `todowrite` tool parts (`deriveTodosFromMessages`); V1 stays server-authoritative
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
- `worktrees`
- `mcpStatuses`
- `diagnostics`
- `chatPreferences`

### `chatPreferences`

Current fields:

- `mode`
- `providerId`
- `modelId`
- `enabledModelIds`
- `providerModelSelections`
- `recentModelIds`
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
- `hideSubagentChats`

These values combine true application behavior settings and output-style preferences that are sent to the model as prompt instructions.

`workspaceFiles`, selected file content, worktrees, and MCP status/config are server-derived and not persisted. Text edits remain local to the Workspace screen until the provider conflict-checks and saves them as a VCS patch.

## Terminal State

Primary fields:

- `terminals`
- `terminalShells`
- `activeTerminalId`
- `terminalOutput`
- `terminalConnection`

The provider owns the active WebSocket. Opening a PTY clears prior output, obtains a connect ticket, and transitions through `connecting`, `connected`, `error`, or `idle`. Incoming common ANSI CSI sequences are stripped and output is capped to the latest 100,000 characters. Terminal history and selection are not persisted.

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

AsyncStorage keys are defined in `lib/storage-keys.ts`. Secrets use platform
secure storage, never AsyncStorage (see below).

The storage rule for multi-server support is:

```text
credentials
    -> SecureStore (connection password + per-profile passwords)

connection profile metadata and chat preferences
    -> AsyncStorage (never credentials)

server-derived persisted state
    -> connection scope + project scope
```

The connection scope is the canonical, password-free identity from
`lib/connection-scope.ts`: normalized server URL (case-insensitive
scheme/host, case-preserving path and query) plus username. It is the only
supported key for anything that belongs to one server. `getConnectionScope()`
is deterministic and encoded so it can be concatenated into storage keys; do
not re-derive connection keys anywhere else.

Persisted values:

- `opencode-mobile.settings` (connection URL and username; the password lives in secure storage)
- `opencode-mobile.connection-profiles` (saved connections with name and optional per-profile model selection; passwords live in secure storage)
- `opencode-mobile.chat-preferences` (active connection's preferences)
- `opencode-mobile.active-project`
- `opencode-mobile.last-session-by-project` (nested `connectionScope -> projectPath -> sessionId`; legacy flat maps are discarded on hydration)
- `opencode-mobile.pending-notification-sessions` (non-secret connection references, keyed by connection scope + session ID)
- `opencode-mobile.sessions.<connectionScope>.<projectPath>` / `opencode-mobile.session-statuses.<connectionScope>.<projectPath>` (per connection + project cache)
- `opencode-mobile.favorite-sessions` (cross-workspace favorites, each carrying its connection scope)

### Session cache DTO

The per connection + project session cache never stores raw SDK `Session` objects. It writes
an explicit, validated DTO (`CachedSession` in `providers/session-cache.ts`) with
only `id`, `title`, `createdAt`, `updatedAt`, and optional `parentID`. A field
added upstream is not persisted unless the DTO mapping is updated. Sensitive or
large fields such as share URLs, metadata, model choice, tokens, and revert
diffs are deliberately excluded. Session statuses are reduced to their `type`
discriminant.

Each key stores an envelope of `{ cachedAt, sessions }` / `{ cachedAt, statuses }`.
Cache entries older than `SESSION_CACHE_TTL_MS` (7 days) are discarded, and
legacy pre-envelope payloads fail safe and are removed; the next confirmed fetch
republishes the cache. Keys embed the connection scope and then the raw project
path, because project paths are server-local and two servers exposing the same
path must never share cached sessions. Pre-multi-server keys were not scoped and
are simply never read again, so the next confirmed fetch republishes the cache
under the scoped key.

### Favorites DTO

Favorites use the explicit `FavoriteSession` model
(`providers/opencode-provider-types.ts`): `sessionId`, `connectionScope`,
`projectPath`, optional `title`, and `favoritedAt`. The connection scope makes
identical session IDs or project paths on two servers independent, and opening
a favorite switches to the connection that owns it before running the
deep-link flow. The project label is derived from `projectPath` at render time
and is not persisted. Hydration (`providers/favorites-storage.ts`) validates
every field, drops malformed entries individually, drops entries written before
connection scopes existed (they cannot be safely attributed to a server), and
enforces `FAVORITE_SESSIONS_MAX` so a corrupt value cannot hydrate an unbounded
list.

Hydration rules:

- persisted settings are merged over default settings
- persisted chat preferences are merged over defaults and current provider state
- saved connection profiles are hydrated on demand and fully validated, including `modelPreferences`; entries with any malformed field are dropped and unknown fields are ignored
- active project path is restored if present
- last-session map is restored if present and is nested by connection scope; the legacy flat map fails validation and is removed
- each persisted key hydrates independently; a storage read failure leaves that key untouched, while malformed or invalid JSON is removed without blocking other keys
- per connection + project session caches hydrate on app open and on every connection or project switch so the workspace list paints before the server answers; they are written only from confirmed fetch results, so a cached empty list means the server reported no sessions for that project. A late hydration result is discarded unless both the connection scope and project path are still current.

Credentials:

- the active connection password is stored in Keychain/Keystore-backed secure storage via `lib/connection-password.ts`; legacy plaintext `settings.password` is migrated to secure storage and stripped from AsyncStorage on hydration
- each saved profile's password is stored under its own SecureStore key in `lib/connection-profiles.ts`; profile metadata in AsyncStorage never contains it
- pending completion-notification records store only a non-secret connection reference (`serverUrl`, `username`, `connectionScope`) and never a password

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

Context utilization is derived separately by `getLatestContextTokens()`: it walks back to the newest completed `step-finish` and reports that call's prompt (`input + cache.read + cache.write`) plus its reply (`output`). Cumulative session totals are intentionally not used, because every call re-sends the history. All-zero placeholder steps, which the V2 adapter emits for in-flight assistant messages, are skipped so the last completed call stays visible until usage arrives.

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
- session archive/restore and experimental archived-session list
- session messages
- session diff
- session todo
- session prompt or promptAsync
- session instruction entries (V2 mapping for the V1 prompt `system` field)
- session abort
- session summarize
- command list and session command execution
- file find/read/status, VCS info, and VCS patch apply
- experimental worktree list/create/reset/remove
- MCP status/add/connect/disconnect/OAuth plus config-backed enable/disable
- PTY list/create/remove/connect-token and ticket-authenticated WebSocket streaming; shell discovery remains provider-side for server defaults
- LSP/formatter status
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
- a non-secret connection reference: `serverUrl`, `username`, `connectionScope`
- `requestedAt`

Records are keyed by connection scope + session ID, so a pending task on one
server survives switching to another server, and identical session IDs on two
servers never collide. The background monitor resolves the password for the
record's own connection at runtime: first through the saved profile whose scope
matches, then through the active connection when the record belongs to it. A
record whose password cannot be resolved yet is kept for a later run instead of
being discarded or reusing another connection's password.

Regular connection settings and profile metadata in AsyncStorage exclude the
password; legacy plaintext settings are migrated during hydration.

## Important Data Invariants

Current implementation assumes these invariants:

- an active project path is required for session-scoped activity
- a current session ID may temporarily be absent during project switches and bootstrapping
- session caches are safe to keep even when not current
- provider/model selections may need to be corrected after capability refresh
- pending permissions and questions are keyed by `sessionID` and only active/sending-session entries are surfaced
- attachment capability is checked against the selected model before send
- local attachment files larger than 10 MB are rejected before base64 encoding
- `SessionMessageRecord` objects stored in `messagesBySession` are never mutated in place; `mergeSessionMessageRecords` in `lib/opencode/format.ts` adopts a new record object when content changes and preserves record and array references when nothing changed, keeping the WeakMap caches in `toTranscriptEntry` and `getSessionPreviewById` correct

## Non-Persisted But Behavioral State

Some user-visible behavior depends on transient refs not persisted anywhere:

- whether prompt submission is locked
- pending deep-link target (`{ sessionId, projectPath? }`) consumed by `ensureActiveSession()` during boot
- pending notification IDs still awaiting completion
- conversation timing windows
- transcript pagination count in chat UI
- copied-message snackbar state
- currently spoken message ID
- Workspace file edit draft and expected original content
- PTY list, active PTY, connection, and capped output scrollback

A rewrite that only mirrors persisted values would still miss important runtime behavior.
