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
- `serverContract` is the resolved server API contract (`v1` or `v2`), defaults to `v2`, is resolved by probing during `connect()`, and selects native operations or the isolated v1 compatibility implementation
- `currentProjectPath` is the server's notion of current project
- `serverRootPath` is the root directory reported by the server
- `eventStreamStatus` tracks real-time subscription health independently of connection state
- the connection domain also exposes `services`, the Cloud Link connector's remote service-management state (available only for `settings.connect` connections); see [api-contract.md](api-contract.md#connector-service-management-cloud-link)
- failures carry a machine-readable `kind` (`timeout`, `offline`, `auth`, `entitlement`, `tunnel-startup`, `server-incompatible`, `unknown`) alongside the display message; `retryableStartup` remains for Cloud Link activation compatibility

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
- `sessions` are the current project's sessions sorted newest-first; the native list is cursor-paged and every page is read, so a workspace never drops its older chats
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
- `currentDiffs` resolves to the active scope's diff; VCS scopes have no SSE event, so they refresh on a scope change or a workspace file save while active

Important behavior:

- data is fetched lazily when a session is opened or refreshed
- the transcript window is paginated (newest 20 on open, older 20 per scroll-up, bounded at 200); see Message And Transcript Transformation
- message/diff/todo caches are updated by explicit refreshes, SSE events, and polling fallback
- an incoming `session.diff` event only overwrites the turn diff when the surface is not pinned to an earlier turn
- on V2 the server has no todo endpoint, so `currentTodos` derives from the accumulated `todowrite` tool records (`deriveTodosFromMessages`), not just the loaded window; V1 stays server-authoritative
- permission and question entries are updated by SSE events, replies, and server list refreshes
- current-session selectors only read the active or relevant session from these maps

## Capabilities And Preferences State

V2 lists active providers through `/api/provider`; `/api/integration` supplies
the connectable catalog. The adapter merges integration-only entries (without
models until connected) into the provider picker and excludes MCP integrations.
For V2, `activation: auto` describes catalog policy, not a connected account.
The adapter derives connected providers from integration connections or
server-enabled models, excluding explicitly disabled providers. Unconnected
entries remain available in Add provider when they expose a key/OAuth method;
providers with only environment/command methods are omitted from the picker.
Only key and OAuth integration methods map to interactive login;
environment/command methods are not API-key methods. V1 catalog providers offer API-key entry alongside auth metadata,
except known OAuth-only providers. Credentials are written through the existing
provider action and V2 integration key endpoint, then capabilities are refreshed.
Catalog and login requests carry the active workspace location. Go keys prefer
the direct Go integration even when the active provider uses Console for OAuth.
A catalog entry carries `integrationIds` (the provider id plus any linked Console
integration) so credentials can be associated with every provider whose login
method that integration serves. On V2, stored credentials are surfaced per
provider as `accounts` (`{id,label,method,active}`), read from `/api/credential`;
exactly one account is active per integration and the provider is configured when
it has at least one account. V1 providers expose no account list.
Provider auth methods are normalized into one prompt model (text/select/number/
integer/boolean/multiselect/external with `when` conditions); V2 integration
`form` fields and V1 auth metadata both map into it.

Primary fields:

- `currentConfig`
- `availableProviders`
- `providerAuthMethodsById`
- `availableModels`
- `availableAgents`
- `commands`
- `browser` (relative path, directory entries, search results/query, loading/error state, and listing/search actions)
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
- `transcriptFontSize` (global chat message text size in pixels; defaults to 16 and is clamped to 12–24)
- `flatTranscript` (renders the transcript full-width without bubble chrome; defaults to `false`)
- `slimInterface` (shrinks control sizes, spacing, and headers on the text-heavy screens; defaults to `false`)
- `language` (optional; `undefined` follows the OS locale)
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

`browser`, selected file content, worktree inventory/owning project identity, and MCP status/config are server-derived and not persisted. Text edits remain local to `FilePreview` until the provider compares the current server content with the original editor baseline, writes through native v2 `file.write` (or a v1 VCS patch), and verifies the saved text. Failed comparison, write or verification retains the draft. Listing, search and file-open commits check the current client identity and request order; saves check client identity before writing and only update the selected file if that selection is still current. Identical directory paths on different servers do not make a response current.

## Terminal State

Primary fields:

- `terminals`
- `terminalShells`
- `activeTerminalId`
- `terminalRuntime` (scope, opened instances, renderer registration, resize)
- `terminalConnection`

The provider retains one WebSocket per opened PTY in the current connection/project
scope. Each instance reports `connecting`, `connected`, `reconnecting`, `idle`,
`exited`, or `error`, plus its connection generation and optional error. Switching
PTYs changes selection without clearing their xterm displays or closing streams.

Renderer registration starts ticket acquisition. Raw ANSI/VT output is decoded
in arrival order, including asynchronous Blob reads and fragmented UTF-8.
NUL-prefixed cursor metadata is validated and never displayed. Output batches
are acknowledged after xterm parses them; subsequent cursor increments count
UTF-16 characters, matching the server. A replacement renderer resets its cursor
and requests fresh replay. xterm retains 10,000 scrollback lines; the pending
output queue has a 2 MiB limit and fails visibly instead of dropping data.

Unexpected disconnects retry after jittered 1/2/4/8/15-second delays with fresh
tickets. Backgrounding suspends retries and closes transports; foregrounding
reconnects. Authentication/removal failures and clean PTY exit stop automatic
retry. Input requires a connected transport and matching scope/generation, and is
never replayed after reconnect. Visible dimensions update the PTY immediately on
first measurement and then with a deduplicated 100 ms debounce. A same-machine
Cloud Link credential rotation also reconnects retained transports with the
rotated credentials instead of disposing them, so the acknowledged cursor and
the renderer surface survive (see the rotation note under connection state).

Exit retains the final display with input disabled. Explicit termination removes
local state only after the server accepts deletion; failure preserves it.
Connection/project reset disposes all transports and renderers. State is retained
only during the app process, with no terminal output or history written to disk.
The server replay buffer is finite: renderer loss cannot guarantee recovery of
output older than that buffer.

## Conversation State

Primary fields:

- `conversationPhase`
- `conversationSessionId`
- `queuedConversationPrompt`
- `pendingConversationTurn`
- `conversationFeedback`
- `conversationFeedbackAction`
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
- `opencode-mobile.connect-control-plane` (last automatically resolved Cloud Link environment; defaults to production, accepts only production/staging, hydrated before pairing/Cloud Link startup)
- `opencode-mobile.connection-profiles` (saved connections with name and optional per-profile model selection; passwords live in secure storage)
- `opencode-mobile.chat-preferences` (chat preferences, including the global UI `language`; not connection-scoped)
- `opencode-mobile.active-project`
- `opencode-mobile.onboarding-version` (completion-only first-run marker; see below)
- `opencode-mobile.last-session-by-project` (nested `connectionScope -> projectPath -> sessionId`; legacy flat maps are discarded on hydration)
- `opencode-mobile.pending-notification-sessions` (non-secret connection references, keyed by connection scope + session ID)
- `opencode-mobile.widget-snapshot` (bounded Android replies, awaiting-action and plan snapshot: connection scope, language/privacy preference, per-surface observation times, three rows/steps, counts, validated links and optional 160-character previews; no authentication credentials, raw request metadata or tool output)
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

- persisted settings validate known string fields and Cloud Link identity before merging over defaults
- persisted chat preferences validate individual strings, booleans, arrays, maps, and enum values; numeric controls are clamped to their supported ranges before merging over defaults and current provider state
- saved connection profiles are hydrated on demand and fully validated, including `modelPreferences`; entries with any malformed field are dropped and unknown fields are ignored
- active project path is restored if present
- last-session map is restored if present and is nested by connection scope; the legacy flat map fails validation and is removed
- each persisted key hydrates independently; a storage or credential read failure preserves the unread key and suppresses unchanged default write-back until the user changes that value or relaunches. Malformed or invalid JSON is removed without blocking other keys
- write-back is ordered per key and skips identical successful writes. Errors are reported and failed writes remain retryable. Secure credential writes finish before active connection metadata is written
- per connection + project session caches hydrate on app open and on every connection or project switch so the workspace list paints before the server answers; they are written only from confirmed fetch results, so a cached empty list means the server reported no sessions for that project. A late hydration result is discarded unless both the connection scope and project path are still current.
- onboarding completion is resolved last, so `isHydrated` already implies the assistant's visibility is known. When the marker is absent, an installation that already has a stored settings key, saved profile metadata, or an active project is treated as completed (existing users never see onboarding); a fresh installation starts the assistant. The resolved marker (version 0 when onboarding should run, `CURRENT_ONBOARDING_VERSION` when it should not) is written back by the persistence write-back effect, which makes the decision sticky and stops the settings write effect from later re-triggering migration. Storage read failures report completed, so an unreadable store can never gate an existing user.

Credentials:

- Cloud Link profiles and active settings carry non-secret metadata (control-plane
  URL, machine ID/name, device ID, expiry). Secrets and environment/store-scoped subscription
  sessions use SecureStore. Expired/missing Cloud Link credentials never fall back to
  active passwords; expiry stops streams/sockets. Development web E2E substitutes
  memory only. See [Cloud Link pilot](connect.md).
- Cloud Link setup exposes initialization readiness separately from operation phase.
  Provider-owned `pairLink` securely accepts scanned/deep-linked QR data and
  automatically claims after initialization settles and entitlement is verified.
  Subscription recovery and automatic pairing use the existing operation lock;
  failed claims require explicit Retry or a replacement QR.
- First post-claim activation adds `waitingForApproval` and `delayed` phases.
  Its in-memory provider checkpoint retains the saved profile and a cancellable
  wait, not the redeemed QR. `ConnectionState.retryableStartup` classifies raw
  transport failures before display formatting. One 120-second budget includes
  request time, pauses attempts in background and survives foreground return;
  delayed retries are explicit. Valid credentials are reused without near-expiry
  rotation during startup; actual credential expiry remains blocking. This wait
  does not apply to normal reconnects. See [Cloud Link](connect.md).
- `connectSetup.subscriptionExpiresAt` exposes only the verified session's
  paid-through timestamp, not its bearer token or a renewal prediction.
  `manageSubscription()` uses the existing operation lock and refuses to open
  store management during initialization or a pending purchase. Platform store
  handoff belongs to `lib/connect-store.ts`; Settings owns only presentation.
- Failed subscription operations return to an idle phase while retaining their
  provider checkpoint. Purchase environment routing automatically switches scope
  after the operation releases its lock, retaining the same native transaction
  and a matching secure QR. Only production and staging are trusted. A verified
  session awaiting secure save or store finalization blocks switching environments.
  The provider exposes `canPurchase` so the UI cannot offer another subscription
  while that checkpoint still needs recovery or store approval is pending.
- Cloud Link uses a default phone name and backend-issued device credentials.
  Native purchase/Restore verifies ownership, securely saves the issued session,
  then finalizes the store transaction. Pending QR continuation is secure;
  subscription expiry preserves profiles, and access refresh keeps machine/profile
  identity while migrating credential-scoped remembered state.
- Automatic Cloud Link recovery waits for store initialization and unfinished
  subscription finalization, then rereads saved credentials. Requests for the
  same environment/machine share one access/save operation; different machine
  saves are ordered because they share the secure-save checkpoint. A late
  recovery cannot replace a connection selected while it was in flight.
- Foreground return schedules recovery even after credential expiry or loss.
  Failed automatic recovery retries after 60 seconds while active; backgrounding
  cancels retry timers. Same-machine renewal keeps the workspace selection.
  Provider-owned profile state refreshes when the Cloud Link profile snapshot
  changes, including renewal of inactive saved machines.

- the active connection password is stored in Keychain/Keystore-backed secure storage via `lib/connection-password.ts`; legacy plaintext `settings.password` is migrated to secure storage and stripped from AsyncStorage on hydration
- credentials hydrate only when stored server metadata supplies a valid identity; unread metadata never lends an old password to the default server. Invalid background connection references do not resolve credentials
- each saved profile's password is stored under its own SecureStore key in `lib/connection-profiles.ts`; profile metadata in AsyncStorage never contains it
- all profile read/modify/write operations share the storage module's transaction queue, including credential rollback and read-time sanitation. A transient storage read failure never becomes a destructive empty-list write
- new server URLs containing userinfo are rejected before probing or saving. Legacy profile/settings/notification URLs are scrubbed without importing unused URL credentials; IDs and separately configured username/password fields remain intact
- Basic authentication preserves password whitespace and encodes username/password as UTF-8
- manual profile saves trim the name and default blank names to the normalized
  hostname, excluding scheme, port and path. Existing IDs, usernames, scopes and
  storage format are preserved; saving an edit does not automatically reconnect.
- manual setup probes are read-only, abortable and ignored after Back, address
  changes or dismissal. Authentication-blocked/unknown outcomes never become a
  V1 label. Form values survive step changes and retries.
- local V2 QR redemption returns a session token, stored in the existing password
  slot before connecting. Pairing codes are never persisted or retained in saved
  URLs. A failed save retains the token in form state; a failed connection retains
  the saved profile ID, so retry does not redeem again or create another profile.
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

Server-provided session cost and token totals are authoritative when available;
fetched call usage is never added to those totals. Without server totals the
provider reports observed usage from loaded history and labels incomplete totals.
A per-session map keyed by stable step ID (`session:message:part`) retains fetched
calls as the transcript window moves, without counting replayed calls twice.
Model/provider breakdowns and call counts describe observed history, and are
marked partial when the contiguous loaded window has not reached its beginning
or has hit the 200-record cap. The app never fetches all history just for usage.
Observed step cost uses model-price USD estimates only when recorded cost is
zero/absent and tokens are nonzero; an authoritative session cost of zero remains
zero.

Context utilization is derived separately by `getLatestContextTokens()`: it walks back to the newest completed `step-finish` and reports that call's prompt (`input + cache.read + cache.write`) plus its reply (`output`). Cumulative session totals are intentionally not used, because every call re-sends the history. Native in-flight messages produce no placeholder usage steps. Repeated updates replace the usage entry for the same call, and todo records update by message identity, so paging and event replay preserve accumulated totals.

### Session Preview By ID

Derived from message history using `getHistoryPreview()`.

### Active Sessions Across Workspaces

`providers/use-active-sessions.ts` keeps a connection-scoped snapshot of every
session on the connected server (sessions + statuses) fetched through the
unscoped catalog client. The snapshot is tagged with its connection scope; a
scope change therefore hides it immediately without a reset pass.
`getActiveSessions()` (`providers/active-sessions.ts`) derives the Chat Library
group from it:

- the group is connection-wide, not filtered by the active workspace, so it is
  stable across workspace switches
- archived sessions are always excluded; subagent chats are excluded when
  `hideSubagentChats` is on
- running (busy/retry) sessions sort first by most recent update, followed by the
  most recently updated idle sessions, and the whole list is capped at
  `maxTotal` (4)

The Chat Library removes these session IDs from the current-workspace Chat list so
a session never appears in both places. The snapshot seeds on connect and on every
catalog-client change, refreshes when the library opens, and polls every 20
seconds only while the library is open and a session is running. A transient
fetch failure keeps the previous snapshot. The snapshot is in-memory only and
does not share the per-connection+project session cache.

### Current Pending Requests

A failed permission or question list read leaves that surface unchanged. A
successful empty list clears it; both reads failing rejects the refresh.

Derived by preferring:

- current session ID
- sending session ID
- every descendant of those sessions (the full `parentID` subtree), so a
  permission or question raised by a subagent or nested sub-subagent is
  surfaced in the active chat instead of hanging its subtree

Only requests owned by the current/sending session, its descendants, or the
server's `global` sentinel are shown. Permissions from unrelated sessions are
not flattened into the active chat.

Each surfaced request carries a display-only `sourceTitle` (the requesting
session's title) so a subagent prompt shows provenance. Prompt errors are
scoped the same way: an error from a session in the active tree (for example a
failed subagent) is shown in the parent chat instead of being hidden.

### Server Approval Interactions

Two server-originated approval surfaces are grouped under the chat `approvals`
value:

- `mcpAuth`: set by `mcp.browser.open.failed` (`mcpName`, `url`); rendered as an
  in-chat alert until dismissed or the named MCP server connects.
- `savedPermissions`: V2 `permission.saved` always-allow rules, listed and
  removable from Settings. Refreshed when the section opens and after an
  `always` permission reply. Empty on V1, which has no saved-rule surface.

### Conversation Status Label

Derived from phase plus latest non-display transcript activity.

## Message And Transcript Transformation

Session history is paginated. Opening a session loads only the newest 20 raw
records; scrolling to the top of the transcript pulls the previous 20 through
the server's backward cursor, and the loaded window is bounded at 200 records
with the oldest records dropped on overflow. Tail activity (SSE part/message
updates, the safety poll, idle completion) fetches only the newest page and
union-merges new records into the window, bridging backwards a bounded number of
pages if a burst of messages arrived, so older loaded records are never
re-downloaded. Removal, revert/unrevert, compaction, and reconnect reconciliation
rebuild the window authoritatively instead of merging.

V1 pages backwards with `limit`/`before` and an `x-next-cursor` header; V2
translates descending API pages and opaque cursors into the same contract,
omitting `order` on cursor requests. Concurrent equivalent message, diff, todo,
and session-list reads share only outstanding requests within a client identity;
settled results are not cached. Diff refreshes reuse the loaded transcript (or
one newest page on a cold cache) to locate the latest user turn; V2 session
status and listing share their session-list request.

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

### Native OpenCode 2 baseline

The primary SDK is `@opencode/client`. Services use native location/project discovery, session create/list/active/update/fork/revert/interrupt, message cursors, turn diffs, instructions, inbox delivery, model/agent selection, command execution, permission requests/replies, forms, provider integrations/accounts, file read/write/search/list, VCS status/diff, MCP runtime lifecycle and OAuth, worktrees, PTY tokens and the native event stream.

The app projects native records into its own presentation models. It derives plans from accumulated `todowrite` records and usage from accumulated assistant calls rather than the bounded transcript page. Session hydration restores persisted summaries as summaries, never as complete SDK records. Stored keys and DTO schemas are unchanged.

### OpenCode 1 compatibility extensions

`lib/opencode/compat/v1/` preserves legacy operations and event semantics. Sharing, archive/restore, title summarization, general configuration writes, persistent MCP enablement, worktree reset, and LSP/formatter diagnostics are exposed only for v1. Native v2 never reports success for unsupported mutations.

MCP authorization exposes grouped `methods/start/complete/wait/cancel` actions. Native authorization uses the MCP server's `integrationID`, carries automatic or code mode, and reuses the provider authentication form model. Connection changes invalidate results and cancel pending attempts.

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

On Android native builds, the provider also observes all tasks on the connected
server, including other workspaces and desktop submissions. It holds a transient
server-wide snapshot plus observed root IDs, connection scope, and notification
cycle. Busy descendants, retries, queued inbox messages, and pending interactions
keep their root active. The selected notification task prioritizes blockers,
then the current running chat, then recency. The four-item Chat Library cap does
not apply. Retry statuses reuse the provider's existing reconciliation policy.

Only successful catalog, status, interaction, inbox, and transcript reads can
end monitoring; failed reads preserve active work and display Reconnecting.
Completion record deletion returns whether the matching record was removed,
so the provider and activity observer cannot both emit completion notifications.
The foreground flush and the background monitor classify a session through the
shared settlement read (`readSessionSettlement`): running, retrying, and blocked
states keep the record, aborted clears it silently, and finished/failed notify
with matching copy. A record from a previous app session is only cleared after a
fresh server read confirms a terminal state, so a cold start cannot post a
completion from a persisted idle status. A record whose project differs from the
active project is left untouched rather than cleared from the wrong session list.
Observed desktop tasks reuse the non-secret pending DTO below; insert-if-absent
does not overwrite a prompt's existing timestamp, and conditional deletion
cannot remove a later submission. Connection switches retain durable records
while clearing the previous connection's live notification.

Pending completion notification storage records:

- `sessionId`
- optional `sessionTitle`
- `projectPath`
- a non-secret connection reference: `serverUrl`, `username`, `connectionScope`
- `requestedAt`
- an optional non-secret `attentionKey` marking the last needs-input alert raised

Records are keyed by connection scope + session ID, so a pending task on one
server survives switching to another server, and identical session IDs on two
servers never collide. The background monitor resolves the password for the
record's own connection at runtime: first through the saved profile whose scope
matches, then through the active connection when the record belongs to it. A
record whose password cannot be resolved yet is kept for a later run instead of
being discarded or reusing another connection's password.

Pending-record reads and mutations use one module-owned queue, including
background-monitor writes. A failed read aborts a mutation without deleting the
key; malformed JSON is handled separately. After network checks, the monitor
re-reads under that queue and removes/notifies only a record with the same
`requestedAt`, preserving additions and re-sent prompts. The queue serializes
one JS runtime; it does not provide transactions across multiple processes.

Regular connection settings and profile metadata in AsyncStorage exclude the
password; legacy plaintext settings are migrated during hydration.

## Important Data Invariants

Current implementation assumes these invariants:

- an active project path is required for session-scoped activity
- a current session ID may temporarily be absent during project switches and bootstrapping
- session caches are safe to keep even when not current
- provider/model selections may need to be corrected after capability refresh
- pending permissions and questions are keyed by `sessionID` and surfaced for the current/sending session and its full descendant subtree, not unrelated sessions
- attachment capability is checked against the selected model before send
- local attachment files larger than 10 MB are rejected before base64 encoding
- OpenCode 2 prompt admission retains the server inbox ID, text, files and
  delivery mode. Pending messages stay above the composer until their ID appears
  in the transcript or the server removes them. Inbox reads precede transcript
  reads; failed reads retain pending entries. Local sending placeholders are
  removed on failure, leaving composer retry behavior intact. Pending state is
  scoped to the client and session, recovered from the server on open/reload,
  and included in realtime polling reconciliation.
- `promptDelivery` is a persisted chat preference (`steer` by default or `queue`,
  labeled Append). The top of Advanced Settings exposes it only for OpenCode 2.
  V1 submissions retain their existing behavior.
- File transcript details preserve URI, MIME type and filename, including V2
  returned file bytes. File-only assistant messages remain displayable.
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
- PTY list, active PTY, per-PTY connection state, and renderer registration

A rewrite that only mirrors persisted values would still miss important runtime behavior.

## Realtime Recovery Ownership

`use-opencode-realtime.ts`, composed by the provider, reconciles session/status,
pending permission/question lists, and selected/conversation message, diff, and
todo snapshots on the first envelope of every subscription, including reconnects.
Only one reconciliation runs at a time, and a reconnect's authoritative rebuild
is queued behind an in-flight safety poll rather than coalesced into it. SSE
remains primary; a safety poll runs during active work even when SSE is connected,
every 10 seconds while connected and every 5 seconds while disconnected. A
submitted prompt also schedules a one-off transcript refresh after 5 seconds so a
missed completion still lands. The first envelope of a subscription reconciles
authoritatively (rebuilding the transcript window); later ticks tail-merge. Idle
connected sessions do not poll.
A liveness watchdog runs only while the app is foregrounded: a stream that has
received no envelope for 90 seconds (3 seconds in E2E builds) is re-subscribed
once per window, and a foreground return either retries immediately (when the
stream is not connected) or cycles a stream that was backgrounded for 15 seconds
or more. Envelope timestamps advance the window, so a healthy server never
reconnects. Stream failures classified as invalid credentials or entitlement
(`auth`/`entitlement`) stop the retry loop and notify the provider, which routes
Cloud Link to its prepared credential recovery and manual connections to an
actionable error state.
An event-derived `retry` status is preserved across session-list refreshes
(`mergeSessionStatuses`), so an automatic retry stays busy and its safety poll
continues instead of freezing on a missed event. Stable latest-action bridges
prevent provider renders from reopening the stream. Cleanup aborts subscriptions
and cancels poll/retry timers. Domain responses retain the provider's
client-scope guards.

### Chat options and review presentation

The composer owns only temporary input-height state on Android/web; iOS grows the native multiline input itself. Agent selection uses the existing selector; reasoning is a discrete slider in the existing model picker. The sole approval control is a capability-gated toolbar toggle. `ChatView` owns the draft and keys the composer by session, inner tab, and pending interaction IDs; selector modals do not persist visibility. Existing preference updates and auto-approval orchestration remain in the provider. Failed direct auto-approval changes retain the current value and use the existing send feedback.

Patch review resolves an assistant message's `parentID` only against user messages in the current session (`getUserTurnForMessage`). A match sets Turn scope and selects that user turn through the existing provider actions. Missing matches open the existing changes view without selecting a historical turn. The review callback is included in transcript memoization and list extra data.

Workspace browser state and request-scope guards remain provider-owned. `FilesPanel` owns only the draft search input and renders provider loading/error state; it remounts on the password-free connection identity plus workspace path. It does not fetch, persist, or cache results. Setup still uses the existing connection-switch path exactly once per guarded submission.


## Session library recovery (#64)

The V1 experimental list with `archived=true` includes active sessions. The archive list uses the unscoped catalog client so sessions from other workspaces remain reachable. The session service filters archived records after traversing pages; active lists exclude records with a truthy `time.archived`. `restoreSession(id, { projectPath, open })` restores through the target workspace client, refreshes the lists, and optionally reopens the same session. Connection changes abort continuation. Explicit open targets absent from cached lists trigger a fresh list read rather than creation of a replacement session.


Transcript, diff, and todo cache pruning is paused while session bootstrap is loading. A pending deep-link target is also retained until selection completes, so early transcript reads survive slower capability/configuration requests when reopening a favorite from another workspace.

## Workspace file browser

Workspace retains its tab label and route. Files is its main surface: the provider
owns the current relative directory, sorted folder/file entries, submitted search,
results, loading/error state and request-order guards. It retains the directory
across tab switches and resets on scoped-client changes; it is not persisted.
Search spans the selected workspace root and clearing it restores the browsed
folder. Breadcrumb navigation cannot leave that root. Listing, search, preview
and save require a selected directory. The OpenCode 2 filesystem adapter passes
`location[directory]` on every request and rejects malformed UTF-8/binary content.
Text editing compares the server content against the editor baseline, writes
through native v2 `file.write` or the v1 patch path, and verifies the saved text.
Unsaved edits require discard confirmation. The pre-read/write race remains
because neither path provides a conditional-write contract.

The shared Workspace/Chat picker contains worktree inventory for the owning
project, resolved from the scoped project API rather than path prefixes. Adding a
validated directory selects the requested path, including a worktree, rather than
its owning project root. Selection uses the existing provider workspace action and applies across Chat,
Workspace and Terminal. Creation stays in the picker; reset/remove live in row
menus, preserve confirmations and reject the active directory and primary checkout.
OpenCode 2 hides reset/startup commands and maps directory-only inventory to names.
The browser groups state and actions under one context member, keeping the public
context below the 135-member ceiling. Screens and components call provider actions;
services and protocol modules own requests and response normalization.

## App update state

`useAppUpdates` holds the native snapshot, the update-check preference (enabled and
check period) and interaction gates in the provider. Only discovery time, the
update-check preference and the version/stage dismissal are persisted under
`opencode-mobile.app-updates`. Drafts and form contents remain local; blocker
tokens report presence only. Downloaded state is recovered from Play and never
triggers installation automatically. Safe available candidates on Play open native
consent directly; only downloaded candidates render an Android banner. iOS
candidates retain an explicit App Store action. See [app updates](app-updates.md).

## Inbound share and widget state

`use-share-state` owns one in-memory receipt and its ten-minute deadline. The
preview destination defaults after hydration and is independent of the open
session until Add. Confirmation is bound to connection + project + session;
consumption clears it synchronously so Strict Mode/route rerenders cannot append
it twice. Discard/expiry cancel pending reads and navigation. A failed opening
retains both payload and any newly created target for retry.

`use-widget-state` owns last-known provider snapshots and guarded service reads.
Replies and attention have independent observation times; failed reads retain
previous data. Current plan is projected from accumulated V2 todo records or V1
todos. Scope changes clear previous-server content, and writes are serialized
before repaint. `showWidgetPreviews` defaults to true in existing preference
storage; false removes all reply/request/step text from snapshots. Headless reads also
check persisted preferences so a newer privacy choice overrides an older queued
snapshot; unreadable preferences hide excerpts. Widget locales do not mutate app
language. Legacy title/
status snapshots remain readable. Headless rendering has no API access. Live
updates stop when Android suspends JS; timestamps explicitly represent cached data.
