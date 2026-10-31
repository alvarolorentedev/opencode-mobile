# State And Data Model

Related ADR: [0002 provider-centric orchestration](../adr/0002-provider-centric-orchestration.md)

## Read by task

| Task | Read |
| --- | --- |
| Understand ownership | [State Ownership Overview](#state-ownership-overview) |
| Change connection or preferences | [Connection And Environment State](#connection-and-environment-state), [Capabilities And Preferences State](#capabilities-and-preferences-state), [Persisted Data](#persisted-data) |
| Change projects or sessions | [Project And Session Identity State](#project-and-session-identity-state), [Session Content Caches](#session-content-caches) |
| Change transcript shaping | [Message And Transcript Transformation](#message-and-transcript-transformation), [Derived Data](#derived-data) |
| Change terminal or conversation mode | [Terminal State](#terminal-state), [Conversation State](#conversation-state) |
| Change realtime recovery | [Realtime Recovery Ownership](#realtime-recovery-ownership) |
| Check invariants | [Important Data Invariants](#important-data-invariants) |

## State Ownership Overview

The application uses provider-owned React state. `WorkspaceProvider` owns the app-wide registry and persistence; each retained `WorkspaceRuntime` owns one connection/project branch. Existing domain hooks read the branch supplied by `WorkspaceScope`.

State is split into seven practical domains:

1. connection and environment state
2. project and session identity state
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
- `network` is the normalized reachability snapshot (online, type, metered,
  constrained, generation) sampled once by `WorkspaceProvider` and passed into
  every retained runtime. NetInfo is not configured per project.
- `reconnect` tracks the bounded connect-retry attempt and next retry time
- the connection domain also exposes `services`, the Cloud Link connector's remote service-management state with its connector-reported management revision and port pool. The provider resolves the target machine from the active Cloud Link connection or a saved Cloud Link profile (so it works while another connection is active), exposes the target/machine list and unavailable reason, and keeps the list keyed by that target scope; see [api-contract.md](./api-contract.md#connector-service-management-cloud-link)
- failures carry a machine-readable `kind` (`timeout`, `offline`, `auth`, `entitlement`, `tunnel-startup`, `server-incompatible`, `unknown`) alongside the display message; `retryableStartup` remains for Cloud Link activation compatibility

## Project And Session Identity State

Primary fields:

- `activeProjectPath`
- `serverProjects`
- `sessions`
- `sessionStatuses`
- `currentSessionId`
- `lastSessionByConnection`

Meaning:

- `activeProjectPath` is the app-selected project context
- `serverProjects` are raw projects returned by the server
- `sessions` are the current project's sessions sorted newest-first; the native list is cursor-paged and every page is read, so a project never drops its older chats
- `sessionStatuses` stores per-session runtime status from the server
- `currentSessionId` is the selected/open session
- an explicit selection stays selected while the project session list catches up with a catalog row; once the list includes it, normal reconciliation handles later removal
- `lastSessionByConnection` persists the remembered session ID per connection scope and project path, so the same path on two servers remembers different sessions

## Session Content Caches

Primary fields:

- `messagesBySession`
- `diffsBySession`
- `todosBySession`
- `pendingPermissionsBySession`
- `pendingQuestionsBySession`

These are keyed by session ID and held in memory.

`diffsBySession` holds normalized `FileDiff` entries. Both contracts pass through `lib/opencode/diff.ts` before they are stored, so a v1 `before`/`after` pair arrives with a rebuilt unified `patch` and the viewer renders the same line preview for either contract.

Diff scope state:

- `diffScopeBySession` records the selected Files Changed scope (`turn`, `uncommitted`, `branch`) per session; it defaults to `turn`
- `selectedDiffMessageBySession` records which user turn the `turn` scope is pinned to; it is cleared when a new prompt is sent
- `selectedDiffMessageId` and the diff request both resolve through `resolveDiffTurn(messages, pinnedTurnId)` in `lib/opencode/transcript.ts`: a still-valid pin wins, then the newest turn that recorded a change, then the newest user message for a turn still running before its first snapshot. Display and fetch therefore never drift onto different turns.
- `vcsDiffsByScope` caches the project-scoped `uncommitted`/`branch` diffs, which are not keyed by session
- `currentDiffs` resolves to the active scope's diff; VCS scopes have no SSE event, so they refresh on a scope change or a project file save while active

Important behavior:

- data is fetched lazily when a session is opened or refreshed
- the transcript window is paginated (one newest window of up to 200 on open, older 200-record batches per scroll-up); see Message And Transcript Transformation
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
Catalog and login requests carry the active project location. Go keys prefer
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
- `projectFileStatuses`
- `projectFile` (selected file plus open/save/close/download actions)
- `vcsInfo`
- `worktrees`
- `mcpStatuses`
- `extensions` (in-memory scoped extension snapshot: target config paths, safety state, MCP/plugin/skill/command rows, and shared items)
- `diagnostics`
- `chatPreferences`

### `chatPreferences`

Current fields:

- `mode`
- `themeMode` (`system` by default; `light` and `dark` override the OS appearance)
- `accentColor` (`green` default, plus `blue`, `red`, `purple`, `pink`, and `gray`; each value selects a full light/dark palette)
- `transcriptFontSize` (global chat message text size in pixels; defaults to 16 and is clamped to 12–24)
- `timelineDetail` (`messages`, `reasoning`, or `everything`; defaults to `everything`. It controls rendered activity only, not which transcript records are fetched or retained)
- `flatTranscript` (renders the transcript full-width without bubble chrome; defaults to `false`)
- `slimInterface` (shrinks control sizes, spacing, and headers on the text-heavy screens; defaults to `false`)
- `language` (optional; `undefined` follows the OS locale)
- `providerId`
- `modelId`
- `enabledModelIds`
- `providerModelSelections`
- `modelVariantSelections` (server variant ID per model; `null` means the synthetic Default choice)
- `recentModelIds`
- `autoModel` (enabled, classifier mode, classifier model, per-tier `auto` or
  model ID, and long-chat cache protection)
- `reasoning`
- `autoApprove`
- `autoPlayAssistantReplies`
- `preferOnDeviceRecognition`
- `confirmVoiceCommands` (default true; conversation-mode submission gate)
- `conversationWakePhrase`
- `wakePhraseRequired` (default true; when false conversation mode listens
  immediately and re-arms after each reply)
- `voiceWakeMode` (`phrase` or on-device `local`)
- `localWakePhrase`, `localCommandModel`, `localSpeakerVerification`,
  `localSpeakerThreshold`
- `readInterimAssistantReplies`
- `speechLocale`
- `speechRate`
- `speechVoiceId` (system engine only)
- `ttsEngine` (`system` default, or `local`)
- `localTtsPackId` (explicitly selected on-device model; no default)
- `localTtsSpeakerId` (Kokoro speaker index; `0` for Piper)
- `workingSoundEnabled`
- `workingSoundVariant`
- `workingSoundVolume`
- `responseScope`
- `includeNextActions`
- `hideSubagentChats`

`themeMode` and `accentColor` are app-global appearance settings stored with the chat preferences shell. They are deliberately excluded from `serverPreferences`, so switching connections never changes the theme. `providers/appearance-context.tsx` combines them with the OS scheme for `hooks/use-color-scheme.ts` and `hooks/use-palette.ts`.

The TTS engine, pack, and speaker are device-local and also excluded from `serverPreferences`. Downloaded voice models live under `opencode-tts/<packId>/` in the document directory and are not represented in preferences; Settings derives their status from the filesystem. Removing a pack deletes that directory, releases the native TTS model, and switches to the system engine when it was active. Temporary synthesis WAVs live in the cache directory and are deleted after playback, on cancel, and on the next Settings visit.

These values combine application behavior settings and output-style preferences that are sent to the model as prompt instructions. `modelVariantSelections` is separate: it selects a server-supported variant for the matching model, is checked against the current model catalog, and falls back to Default when unavailable. If there is no saved entry, a valid variant already set on the active session is retained when it uses the selected model.

`autoModel` is server-scoped with the rest of the model selections. Its tier
values are `auto` or a model ID; unavailable IDs are retained and treated as
unavailable at send time rather than erased during a slow capability refresh.
On-device routing requires the pinned GGUF pack; OpenCode routing requires a
successful `generate.text` probe. Neither mode falls back to a heuristic
classifier. See [auto model routing](../product/auto-model-routing.md).

`browser`, selected file content, worktree inventory/owning project identity, and MCP status/config are server-derived and not persisted. Text edits remain local to `FilePreview` until the provider compares the current server content with the original editor baseline, writes through native v2 `file.write` (or a v1 VCS patch), and verifies the saved text. Failed comparison, write or verification retains the draft. Listing, search and file-open commits check the current client identity and request order; saves check client identity before writing and only update the selected file if that selection is still current. Identical directory paths on different servers do not make a response current.

The Extensions snapshot is also server-derived and not persisted. It is keyed to the client and project that produced it, so a connection or project switch immediately hides the previous snapshot. Writes are serialized by the provider. Config mutations read the raw JSONC, create a backup, write a same-directory temporary file, verify its bytes and the server-reloaded document, and atomically rename it over the target; a failed replace or server load restores the backup. Global config reads and atomic moves use fixed shell commands with validated absolute paths, while project files use the normal file API. No config contents are stored locally or logged. Removed skills move to `.opencode-mobile-trash` under their scope rather than being deleted.

## Terminal State

Primary fields:

- `terminals`
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

- `conversationPhase` (input: `off`, `armed`, `listening`, `submitting`)
- `conversationReadbackPhase` (`idle`, `waiting`, `speaking`)
- `conversationSessionId`
- `queuedConversationPrompt`
- `pendingConversationTurn`
- `conversationFeedback`
- `conversationFeedbackAction`
- `conversationLatestHeardText`

Input and readback are independent. Submitting a turn immediately returns input
to `armed`, so a steer or queued command can arrive while the assistant is
working. A separate readback watcher waits for the settled assistant reply and
then reads the final bubble aloud. Wake detection is paused only while TTS owns
the audio session and resumes when readback finishes.

Supporting refs and timers hold important transient control state for:

- whether cancellation was requested
- whether a submission is in flight
- pending transcript waiting to be flushed; results accumulate onto it across
  recognizer segments and listening restarts instead of replacing it
- assistant-reply baseline tracking
- final-result settle timeout
- listening-restart timeout

Chat dictation and conversation mode share `lib/voice/transcript-accumulate.ts`.
Interims replace only the current segment; finals commit it. A recognition `end`
checkpoints any unfinished interim before a native, network-fallback, or provider
restart. New segments append verbatim: Unicode letters, combining marks, numbers,
punctuation and intentional repeated words are preserved. Text overlap alone is
not evidence of replay, so it never removes words.

Conversation submission waits 2200ms after a final result or recognition end.
Speech onset or an interim cancels that timer until the next final/end, preventing
a previous finalized segment from submitting while the user continues speaking.
Restarts preserve the accumulated turn; submission, cancellation and new turns
reset it. Native events and stop/abort calls belong only to the speech hook that
started recognition, keeping chat dictation and conversation mode isolated. A
competing start is rejected until the current session (including a pending
network retry) ends, so ownership cannot strand the previous listening surface.
Abort retains a live session until native `end` drains its delayed events.
Permission-only starts and retry gaps cancel immediately. A per-session terminal
listener survives hook unmount to release ownership even after its UI disappears.
Permission-dialog `inactive` transitions do not cancel a start. Actual
backgrounding stops conversation mode, clears its unsent turn/timers and blocks
recognition starts; returning foreground requires explicitly starting a new turn.

This means conversation mode is partly state-driven and partly timer/ref-driven.

## Refresh / Loading State

Primary flags:

- `isRefreshingMessages`
- `isRefreshingDiffs`
- `isRefreshingProjectCatalog`
- `isBootstrappingChat`
- `hydratingSessionIds` (transcript-hook state, not a context member)
- `sendingState`

These flags drive loading indicators and control decisions such as whether conversation mode may start.

Session selection is local-first. `ensureActiveSession()` and `openSession()`
commit `currentSessionId` as soon as the target is known; transcript, diff,
todo, interaction, capability, server-feature, and diagnostic reads continue in
the background. `isBootstrappingChat` covers target resolution, while the
per-session `hydratingSessionIds` map covers the first transcript read (and the
prompt-inbox read that precedes it) so a slow read for an older chat cannot
clear the current chat's skeleton. `openSession()` marks the selected session as
hydrating before starting either read, so the skeleton appears immediately. The
composer and chat header are usable during hydration; transcript content fills
in as it arrives.

Cold transcript read failures are tracked separately by
`useTranscriptReadErrors`, keyed by session and tagged with the client that
issued the read. A non-silent failure stays visible until a later successful
read clears it, and reconnecting or switching servers hides the old client's
errors. This lets Chat distinguish "the read failed" from "the session is
empty" without introducing a second transcript store or changing the paging
window.

An explicit `openSession()` invalidates any in-flight initial bootstrap and
writes `currentSessionIdRef` synchronously, so a render-delayed bootstrap cannot
reselect the remembered chat after the user created or opened a different one.
`explicitSessionSelectionRef` bridges the render gap until the new session is in
the live `sessionsRef`; pending deep-link targets still validate against the
server.

In-app navigation uses the workspace registry's `navigate(target)`: it prepares
the owning workspace runtime, calls that runtime's local `openSession()`, then
moves focus. It never reads or validates the server session list, so a slow
remote link cannot turn a rendered chat tap into a "not found" error. A stale
favorite that is absent from every loaded runtime catalog triggers one catalog
refresh to report the missing chat; rows rendered from a catalog or project list
never wait on a list read. External entry points (notifications, widgets, quick
actions, and OS links) keep using `openDeepLinkSession()` from
`app/session/[id].tsx`, which resolves the connection and validates the target
before switching.

A session created or forked locally is retained for a short grace period if a
list read that started before creation resolves afterward. This prevents a
stale cursor page from dropping the new chat before the list catches up.
Session-list, capability, server-feature, and project-catalog event bursts are
coalesced; `session.deleted` removes its row immediately before reconciliation.
The focused workspace's overridden domains are memoized independently, so a
transcript update cannot invalidate connection, project, or onboarding
contexts.

An optimistic permission reply removes the card immediately and records its ID
in `suppressedPendingRequestIdsRef` until the server accepts or rejects it. A
polling/interaction refresh ignores suppressed IDs so the card cannot flicker
back. A failed reply restores the card and clears the suppression. Question
replies stay blocking because the question flow owns draft answers and inline
retry state.

## Persisted Data

AsyncStorage keys are defined in `lib/storage-keys.ts`. Secrets use platform
secure storage, never AsyncStorage (see below).

The storage rule for multi-server support is:

```text
credentials
    -> SecureStore (connection password, per-profile passwords, custom gateway headers)

connection profile metadata and chat preferences
    -> AsyncStorage (never credentials)

server-derived persisted state
    -> connection scope + project scope
```

One local file sits outside AsyncStorage and secure storage: `lib/error-reporting.ts`
records the last JS error to `LAST_JS_ERROR_FILENAME` in the app's documents
directory, and `readLastJsError()` parses it for Settings → Diagnostics. It never
leaves the device; there is no remote reporter.

The connection scope is the canonical, password-free identity from
`lib/connection-scope.ts`: normalized server URL (case-insensitive
scheme/host, case-preserving path and query) plus username. It is the only
supported key for anything that belongs to one server. `getConnectionScope()`
is deterministic and encoded so it can be concatenated into storage keys; do
not re-derive connection keys anywhere else.

Persisted values:

- `opencode-mobile.settings` (connection URL and username; the password and custom gateway headers live in secure storage)
- `opencode-mobile.connect-control-plane` (last automatically resolved Cloud Link environment; defaults to production, accepts only production/staging, hydrated before pairing/Cloud Link startup)
- `opencode-mobile.connection-profiles` (saved connections with name and the optional server-scoped preferences: provider/model, enabled models, per-provider and variant selections, agent mode, auto-approve, and auto-routing tiers; passwords and custom gateway headers live in secure storage)
- `opencode-mobile.chat-preferences` (chat preferences, including the global UI `language`; not connection-scoped)
- `opencode-mobile.active-project`
- `opencode-mobile.projects` (opened projects per connection scope, most-recent-first directory paths; an explicit empty list means the user closed every project and is not re-seeded)
- `opencode-mobile.onboarding-version` (completion-only first-run marker; see below)
- `opencode-mobile.last-session-by-project` (nested `connectionScope -> projectPath -> sessionId`; legacy flat maps are discarded on hydration)
- `opencode-mobile.pending-notification-sessions` (non-secret connection references, keyed by connection scope + session ID)
- `opencode-mobile.widget-snapshot` (bounded Android replies, awaiting-action and plan snapshot: connection scope, language/privacy preference, per-surface observation times, three rows/steps, counts, validated links and optional 160-character previews; no authentication credentials, raw request metadata or tool output)
- `opencode-mobile.sessions.<connectionScope>.<projectPath>` / `opencode-mobile.session-statuses.<connectionScope>.<projectPath>` (per connection + project cache)
- `opencode-mobile.transcript.<connectionScope>.<projectPath>.<sessionId>` (bounded newest transcript tail: 24 records, 200k-character cap, 7-day TTL)
- `opencode-mobile.capabilities.<connectionScope>.<projectPath>` (last-known config/providers/models/agents/auth methods, 300k-character cap, 7-day TTL)
- `opencode-mobile.favorite-sessions` (cross-project favorites, each carrying its connection scope)

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
- persisted DTOs use `zod` schemas at their storage boundary (session, transcript, capabilities, favorites, projects, remembered sessions, onboarding, updates, notifications, connection settings, and chat preferences). Schema parsing strips unknown fields, drops invalid individual entries where the prior parser did, and clears a malformed envelope. Widget snapshots and connection headers remain manual because they enforce bounded projection/redaction and RFC 7230 header rules rather than a record shape.
- persisted chat preferences validate individual strings, booleans, arrays, maps, and enum values; numeric controls are clamped to their supported ranges before merging over defaults and current provider state
- saved connection profiles are hydrated on demand and fully validated, including `modelPreferences`; entries with any malformed field are dropped and unknown fields are ignored
- active project path is restored if present, and the connection's opened projects restore with it; on connect an unlisted active path falls back to the most recent opened project unless the server resolves it (a deep link or worktree)
- last-session map is restored if present and is nested by connection scope; the legacy flat map fails validation and is removed
- each persisted key hydrates independently; a storage or credential read failure preserves the unread key and suppresses unchanged default write-back until the user changes that value or relaunches. Malformed or invalid JSON is removed without blocking other keys
- write-back is ordered per key and skips identical successful writes. Errors are reported and failed writes remain retryable. Secure credential writes finish before active connection metadata is written
- per connection + project session caches hydrate on app open and on every connection or project switch so the project list paints before the server answers; they are written only from confirmed fetch results, so a cached empty list means the server reported no sessions for that project. A late hydration result is discarded unless both the connection scope and project path are still current.
- the transcript tail hydrates when a session opens with no in-memory window. It is validated, TTL-bound, and never overwrites a live refresh that painted first. Writes are debounced and bounded so streaming part events cannot cause one storage write per page.
- the capabilities cache hydrates in parallel with the first capability refresh and is ignored once a fresh response has been applied. It keeps the composer's model/agent choices usable while a slow link answers.
- connection credential rotation migrates the session, transcript, and capabilities caches to the rotated scope.
- onboarding completion is resolved last, so `isHydrated` already implies the assistant's visibility is known. When the marker is absent, an installation that already has a stored settings key, saved profile metadata, or an active project is treated as completed (existing users never see onboarding); a fresh installation starts the assistant. The resolved marker (version 0 when onboarding should run, `CURRENT_ONBOARDING_VERSION` when it should not) is written back by the persistence write-back effect, which makes the decision sticky and stops the settings write effect from later re-triggering migration. Storage read failures report completed, so an unreadable store can never gate an existing user.

Credentials:

- Cloud Link profiles and active settings carry non-secret metadata (control-plane
  URL, machine ID/name, device ID, expiry). Secrets and environment/store-scoped subscription
  sessions use SecureStore. Expired/missing Cloud Link credentials never fall back to
  active passwords; expiry stops streams/sockets. Development web E2E substitutes
  memory only. See [Cloud Link pilot](../product/cloud-link.md).
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
  does not apply to normal reconnects. See [Cloud Link](../product/cloud-link.md).
- `connectSetup.subscriptionExpiresAt` exposes only the verified session's
  paid-through timestamp, not its bearer token or a renewal prediction.
  `manageSubscription()` uses the existing operation lock and refuses to open
  store management during initialization or a pending purchase. Platform store
  handoff belongs to `lib/connect-store.ts`; Settings owns only presentation.
- `connectSetup.storeInstall` resolves through `lib/connect-install.ts` before
  Settings may offer the section: the iOS App Store release type, or a Play
  Install Referrer response on Android. Directly installed APKs, F-Droid/FOSS
  and non-store iOS builds resolve false. It is a visibility flag only;
  existing Cloud Link profiles, pairing and deep links keep working on any
  install.
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
  cancels retry timers. Same-machine renewal keeps the project selection.
  Provider-owned profile state refreshes when the Cloud Link profile snapshot
  changes, including renewal of inactive saved machines.

- the active connection password is stored in Keychain/Keystore-backed secure storage via `lib/connection-password.ts`; legacy plaintext `settings.password` is migrated to secure storage and stripped from AsyncStorage on hydration
- credentials hydrate only when stored server metadata supplies a valid identity; unread metadata never lends an old password or stored gateway headers to the default server. Invalid background connection references do not resolve credentials
- each saved profile's password is stored under its own SecureStore key in `lib/connection-profiles.ts`; profile metadata in AsyncStorage never contains it
- custom HTTP headers for gateways (Cloudflare Access service tokens, Authelia, oauth2-proxy) are a manual-connection credential. `lib/connection-headers.ts` stores the active connection's map and each profile's map in SecureStore (`opencode-mobile.connection-headers`, `opencode-mobile.connection-profile-headers.<profileId>`); names and values are validated (RFC 7230 token names, no CR/LF, 10 rows) and never written to AsyncStorage or workspace metadata. Cloud Link profiles carry no custom headers. Resolution returns the headers with the password so background notifications and widget reads use the owning connection's gateway credentials. `lib/opencode/client/fetch.ts` merges them into every request; the app-generated Basic `Authorization` always wins and transport/framing headers are rejected in the editor
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

Derived from the connection-scoped opened project paths and enriched by `serverProjects` (the server's `project.list()`). A remote project the user never opened is not rendered; a path is opened when selected, added, or followed from a link.

Closing the last opened project clears focus while retaining its runtime
snapshot. `projectClosedValues()` removes that project and its session scoped
values from the focused/read path, so Chat, Settings, Terminal and New Chat show
the no-project state without unmounting the runtime or deleting drafts. Reconnect
uses the opened-project list, not the retained runtime's stale project entry.

Properties include:

- label from the server project's name, else the final path segment
- `id` when the server catalog knows the path
- ordered by the local opened list (most recent first)

### Active Project

Selected from derived `projects` by `activeProjectPath`. A selected worktree is not a project, so it is resolved from the worktree catalog (whose owner is server-resolved) while `activeProjectPath` keeps the worktree directory for file/PTY scoping.

### Current Transcript

Derived by converting `currentMessages` with `toTranscriptEntry()`.

### Current Usage

Server-provided session cost and token totals are authoritative when available;
fetched call usage is never added to those totals. Without server totals the
provider reports observed usage from loaded history and labels incomplete totals.
A per-session map keyed by stable step ID (`session:message:part`) retains fetched
calls as the transcript window moves, without counting replayed calls twice.
Model/provider breakdowns and call counts describe observed history, and are
marked partial until the loaded window has reached the beginning of the session.
The app never fetches all history just for usage.
Observed step cost uses model-price USD estimates only when recorded cost is
zero/absent and tokens are nonzero; an authoritative session cost of zero remains
zero.

Context utilization is derived separately by `getLatestContextTokens()`: it walks back to the newest completed `step-finish` and reports that call's prompt (`input + cache.read + cache.write`) plus its reply (`output`). Cumulative session totals are intentionally not used, because every call re-sends the history. Native in-flight messages produce no placeholder usage steps. Repeated updates replace the usage entry for the same call, and todo records update by message identity, so paging and event replay preserve accumulated totals.

### Session Preview By ID

Derived from message history using `getHistoryPreview()`.

### Active Sessions Across Projects

`providers/use-active-sessions.ts` keeps a connection-scoped snapshot of every
session on the connected server (sessions + statuses) fetched through the
unscoped catalog client. One runtime per connection owns the read and publishes
the snapshot through `WorkspaceProvider`; other retained projects consume it
instead of issuing their own list read. The snapshot is tagged with its
connection scope; a scope change therefore hides it immediately without a reset
pass.
`getActiveSessions()` (`providers/active-sessions.ts`) derives the Chat Library
group from it:

- the group is connection-wide, not filtered by the active project, so it is
  stable across project switches
- subagent chats are excluded when
  `hideSubagentChats` is on
- running (busy/retry) sessions sort first by most recent update, followed by the
  most recently updated idle sessions, and the whole list is capped at
  `maxTotal` (4)

The Chat Library removes these session IDs from the current-project Chat list so
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

Session history is paginated. Opening a session makes one newest-window read of
up to 200 raw records and stores the backward cursor; there is no display-target
backfill loop. Scrolling to the top pulls one older 200-record batch through the
server's backward cursor and prepends it. A single scroll trigger never chains
additional reads. The loaded window is not capped: records the user has paged
through stay in memory so the first message remains reachable and scrolling back
down needs no forward re-fetch. Tail activity (SSE part/message updates, the
safety poll, idle completion) fetches exactly one newest page of 20 records and
union-merges it, so reconcile is bounded and older loaded records are never
re-downloaded or trimmed. When a burst is larger than one page and the newest
page no longer overlaps the held window, the fetched page is adopted and history
paging restarts from its oldest record instead of downloading bridging pages.
Held records can exist without a stored cursor when the transcript cache hydrates
before the first network read, or when a window reset leaves a retained transcript
in place. A tail refresh then keeps those records and stores the newest page's
cursor; if scroll-up runs first, it repairs the newest window once and returns,
and the next scroll pages back. This keeps older history reachable instead of
leaving `hasOlder` false. Only server-side history rewrites rebuild the window
instead of merging: compaction, revert/unrevert, and (on V1) explicit message
removal. A rebuild is one newest-window read of up to 200 records, never a scan.
Reconnects and foreground returns tail-merge. The persisted transcript cache stays
tail-bounded, while retention keeps the current session plus up to three recently
viewed sessions in memory so switching back paints before the background read
settles.

Merge preserves durable server order, never `time.created` order. A response
that arrives after a newer window has been applied can still contain a record
the newer window no longer holds (for example the prompt that started a long
turn). Unseen records are inserted next to the page anchor they follow instead
of being appended, so an older prompt cannot land below newer assistant
replies. A stale page may fill gaps, but it never adopts its own window, moves
the paging cursor backward, or rolls streamed content back. Every window
rewrite (cold open, repair, compaction, revert) starts a new read generation, so
older in-flight tail responses are discarded; a history prepend additionally
requires its captured cursor to still be current. Rewrites bypass read
coalescing, so an in-flight page read before a compaction or revert can never
be reused as the rebuilt window.

The transcript renders the selected `timelineDetail` level: `messages` keeps
user and assistant text/files/errors only, `reasoning` adds reasoning activity,
and `everything` (the default) renders the full native timeline with reasoning,
tool, and patch activity. The preference filters the derived rows; it never
changes the fetched window, transcript cache, diff data, or retention. At
`everything` detail, contiguous visible reasoning, tool, and patch details merge
into one two-level activity run; a message bubble breaks the run. The run key is
its first detail id, so expansion persists while streamed details grow it. The level-one header
keeps the total tool-call count and lists every rendered type once, including
`Thought` when reasoning is present; a reasoning-only run reads `Thought · N`.
A run with a `running`/`pending` tool shows the header progress indicator but
stays collapsed: expansion is always an explicit user toggle, keyed to the run
so a recycled list cell cannot open a different one. While the session itself
remains running, the newest activity run keeps the header progress circle even
after its own tools complete; running work never changes the collapse state. Level-two rows expand reasoning
Markdown; show the shell command collapsed and a selectable, copyable code
block expanded; keep grep to one line with its match count; collapse consecutive
reads to one non-expandable filename list; and render edit/write/patch files as
expandable diff cards. Patch summaries are dropped when a file-change tool in
the same run already supplies the same paths. Run rows use the assistant bubble
width. V1-only subtask/step/agent parts and the V2-synthesized `step-finish`
usage marker are never rendered. The detail filter is applied only while
deriving rows; the initial-pull target and retention continue to use the full
fetched message records.


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
- `retry` -> detail kind `retry`
- `compaction` -> detail kind `compaction`
- `subtask` / `step-start` / `step-finish` / `agent` -> ignored (V1-only or usage markers)

The display filter keeps user/assistant text, files, and errors plus every
reasoning, tool, and patch activity row. Hidden file-mutating tools remain
visible only when they resolved a diff.

That detail is important because the transcript UI is not a raw message dump.

The endpoint and compatibility surface is documented in the
[API contract](api-contract.md).

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

Reconnect reads are not always complete: a server can briefly expose no
providers, models, or agents while it starts up, and capability discovery returns
an empty catalog when no project is active. Those snapshots must not destroy the
stored choices. An empty model catalog preserves the provider, model, and enabled
IDs; an empty agent catalog preserves the stored agent; and enabled IDs for
providers that are temporarily missing stay stored without being rendered. The
catalog is only reconciled once models are present. A partial catalog keeps
unavailable enabled IDs alongside available ones, while a catalog in which none
of the stored IDs resolve falls back to enabling the full catalog so the picker
is never left empty. Empty capability refreshes are also not written over the
last-known-good capabilities cache.

## Notification Tracking Data

On Android native builds, the provider also observes all tasks on the connected
server, including other projects and desktop submissions. It holds a transient
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
servers never collide. The background monitor resolves the password and custom
gateway headers for the record's own connection at runtime: first through the
saved profile whose scope matches, then through the active connection when the
record belongs to it. A record whose password cannot be resolved yet is kept for
a later run instead of being discarded or reusing another connection's password
or headers.

Pending-record reads and mutations use one module-owned queue, including
background-monitor writes. A failed read aborts a mutation without deleting the
key; malformed JSON is handled separately. After network checks, the monitor
re-reads under that queue and removes/notifies only a record with the same
`requestedAt`, preserving additions and re-sent prompts. The queue serializes
one JS runtime; it does not provide transactions across multiple processes.

Regular connection settings and profile metadata in AsyncStorage exclude the
password and custom gateway headers; legacy plaintext settings are migrated
during hydration.

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
  reads; failed reads retain pending entries. An offline/transport failure keeps
  the prompt locally as `queued`; a timeout with an unknown outcome is
  `uncertain` and is never auto-replayed. Flush reconciles the inbox and newest
  transcript before admitting, so a request that reached the server is not
  duplicated. Local sending placeholders are removed only for non-transport
  failures, leaving composer retry behavior intact. Pending state is
  scoped to the client and session, recovered from the server on open/reload,
  and included in realtime polling reconciliation. Canceling a waiting entry
  removes it through the native inbox cancel endpoint and can move its text
  back into an empty composer; only the composer draft is restored, not the
  pending attachments. Queued/uncertain entries can be dismissed locally
  without calling the server with a local ID.
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
- permission request IDs whose optimistic removal is still awaiting server acknowledgement
- per-session transcript hydration request generations
- pending notification IDs still awaiting completion
- conversation timing windows
- transcript pagination count in chat UI
- copied-message snackbar state
- currently spoken message ID
- process-lifetime queued/uncertain prompts and their admission inputs (not
  persisted; the composer draft remains the durable copy)
- Project file edit draft, expected original content, and the selected file's optional inline media bytes
- PTY list, active PTY, per-PTY connection state, and renderer registration

A rewrite that only mirrors persisted values would still miss important runtime behavior.

## Realtime Recovery Ownership

`use-opencode-realtime.ts`, composed by the provider, reconciles session/status,
pending permission/question lists, and selected/conversation message, diff, and
todo snapshots on the first envelope of every subscription, including reconnects.
Only one reconciliation runs at a time, and a reconnect pass is queued behind an
in-flight safety poll rather than coalesced into it. SSE remains primary; a safety
poll runs during active work even when SSE is connected, every 10 seconds while
connected (15 on a constrained link) and every 5 seconds while disconnected (8
constrained). Offline and background states pause it, and repeated failures back
off to 30 seconds. On V2 the poll reads the
active-session status set only; full session lists belong to reconnect,
foreground, library-open, and session-event reconciliation. A submitted prompt also
schedules a one-off transcript refresh after 5 seconds so a missed completion
still lands. Every transcript refresh tail-merges one newest page; only a
compaction or revert event rebuilds the window. Idle connected sessions do not
poll.
Streaming part events refresh the transcript only for the session the user can
see (the active chat, conversation mode, or a session with queued prompts);
background sessions refresh on status transitions and completion. Bursts of part
events coalesce into a single read.
A liveness watchdog runs only while the app is foregrounded: a stream that has
received no envelope or keepalive activity for 60 seconds (45 seconds while
work or a blocking interaction is active; shortened in E2E builds) is
re-subscribed once per window. Keepalive frames reported through the
subscription's `onActivity` callback advance the same window so a long silent
tool call does not restart a healthy stream. Foreground return and an
offline→online transition retry immediately (when the stream is not connected)
or cycle a stream that was backgrounded for 15 seconds or more. Every foreground
return additionally runs one reconciliation pass, because a suspended JS runtime
can miss envelopes while the stream still looks connected and would otherwise
leave a stale or empty transcript until the next event. Envelope timestamps
advance the window, so a healthy server never reconnects. Stream failures
classified as invalid credentials or entitlement (`auth`/`entitlement`) stop the
retry loop and notify the provider, which routes Cloud Link to its prepared
credential recovery and manual connections to an actionable error state.
An event-derived `retry` status is preserved across session-list refreshes
(`mergeSessionStatuses`), so an automatic retry stays busy and its safety poll
continues instead of freezing on a missed event. Stable latest-action bridges
prevent provider renders from reopening the stream. Cleanup aborts subscriptions
and cancels poll/retry timers. Domain responses retain the provider's
client-scope guards.

### Chat options and review presentation

The composer owns only temporary input-height state on Android/web; iOS grows the native multiline input itself. Agent selection uses the existing selector; reasoning is a discrete slider in the existing model picker. The sole approval control is a capability-gated toolbar toggle. `ChatView` owns the draft and keys the composer by session, inner tab, and pending interaction IDs; selector modals do not persist visibility. Existing preference updates and auto-approval orchestration remain in the provider. Failed direct auto-approval changes retain the current value and use the existing send feedback.

Composer context selections live with the retained draft, not in persistence. Selecting a `@` suggestion records the item and its display token; the provider resolves only tokens still present in the final text into native mention ranges. Agent, skill, and file discovery are V2-only (`skill.list`, `reference.list`, `file.find`), while V1 keeps its existing slash-command chips and attachment flow. Shell mode is V2-only and calls `session.shell`; shell timeline records are mapped to the existing activity presentation.

Patch review is the changes chip above the composer and the Changes overlay. The transcript no longer renders a per-message review chip, so no parent-message lookup or transcript memoization dependency is needed for review.

Project browser state and request-scope guards remain provider-owned. `FilesPanel` owns only the draft search input and renders provider loading/error state; it remounts on the password-free connection identity plus project path. It does not fetch, persist, or cache results. Setup still uses the existing connection-switch path exactly once per guarded submission.


## Archived Sessions And Deep Links

Session lists exclude records with a truthy `time.archived`. V1 archive/restore is not supported because it has no V2 equivalent. Explicit open targets absent from cached lists trigger a fresh list read rather than creation of a replacement session. Session idle events only refresh domain state.


Transcript, diff, and todo cache pruning is paused while session bootstrap is loading. A pending deep-link target is also retained until selection completes, so early transcript reads survive slower capability/configuration requests when reopening a favorite from another project.

## Project file browser

The browser's `actions` group owns file-operation availability, feedback,
preflight, rename and paste. `WorkspaceProvider` owns one process-local clipboard
and mutation lock per connection, passed through shared runtime inputs. Entries
carry source root, relative path, file/directory type and copy/cut mode. They
survive tab/project/worktree focus changes, remain isolated between connections,
and clear on disconnect, connection removal/reconfiguration or successful Cut.
Copy remains available for repeated pastes. Registered runtime refresh callbacks
read the latest browser location so mutation completion cannot restore old
navigation. Both affected workspaces refresh file/VCS state and active VCS diffs.
No clipboard or busy state is persisted. See
[ADR 0012](../adr/0012-shell-mediated-project-file-actions.md).


Projects retains its tab label and route. Files is its main surface: the provider
owns the current relative directory, sorted folder/file entries, submitted search,
results, loading/error state and request-order guards. It retains the directory
across tab switches and resets on scoped-client changes; it is not persisted.
Search spans the selected project root and clearing it restores the browsed
folder. Breadcrumb navigation cannot leave that root. Listing, search, preview
and save require a selected directory. The OpenCode 2 filesystem adapter passes
`location[directory]` on every request. Text editing compares the server content
against the editor baseline, writes through native v2 `file.write` or the v1 patch
path, and verifies the saved text. Unsaved edits require discard confirmation.
The pre-read/write race remains because neither path provides a conditional-write
contract.

The selected file carries its normalized kind, MIME type, size, optional inline
bytes and a download capability. V2 media bytes are retained only for inline
previews up to 25 MB; known documents, archives and installers skip the read and
download by streaming the authenticated V2 `fs/read` route. Text files download
through the same route, or from their content on V1. V1 binary content is
unavailable because that server contract returns an empty body. Bytes are
process-local and are released when the preview closes; nothing is persisted.

The workspace header groups worktrees under their owning project, resolved from
the scoped project API rather than path prefixes. The project picker shows
projects only; the worktree selector appears only when a project has multiple
checkouts. Projects owns the interactive selector; Chat shows the same values as
a read-only subtitle under the session title. Adding a validated directory
selects the requested path, including a worktree, rather than its owning project
root. Selection applies across Chat, Projects and Terminal. Creation lives in
New chat; removal preserves confirmations and rejects the active checkout and
primary checkout.
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
candidates retain an explicit App Store action. See [app updates](../product/app-updates.md).

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

## Onboarding preference selections

The assistant writes language, delivery and remembered provider/model through
`updateChatPreferences`, immediately using the existing
persistence and reconciliation paths. Default model is the remembered Chat
selection, not a separate new-chat policy. Its picker and Ready use the same
configured/enabled catalog filter as Chat. Skip does not revert earlier choices.
Navigation omits AI and project without a connection; model selection is hidden
offline and message delivery is also hidden on V1. No onboarding preferences,
credentials or step progress are duplicated in the completion marker.

## Workspace registry and presentation state

`opencode-mobile.workspaces` is a validated version 1 DTO. It records credential-free connection metadata (no password or custom gateway headers), enabled state, server preferences, remembered workspace paths and chat focus. `getConnectionUiScope` identifies runtime owners, including stable Cloud Link machine identities; the existing canonical connection scope identifies persisted favorites, caches and secure profile credentials. Passwords and gateway headers remain per-profile SecureStore data. An unreadable registry is preserved; fallback startup never overwrites that unread value.

A legacy active connection is matched or saved as a profile and migrated into the connected set. Other saved profiles are not connected automatically. Explicit disconnect removes a server from automatic restoration, invalidates in-flight work and detaches its transports. It does not terminate remote prompts or PTYs. Last-good data and drafts remain in memory.

Chat focus is validated against live runtimes. When the focused connection errors or is explicitly disconnected while another enabled server is connected, the workspace manager moves focus to the last healthy server (or the first other connected server) and persists that selection. The failed server remains available in Connection management for Reconnect without replacing the working chat, while server and project selectors omit any server that is not currently connected.

Provider/model/agent selections, visible and recent models, model variants and auto-approve are scoped to a server. New servers default to auto-approve off. V2 auto-approve is a local per-server policy that answers each pending request once, using the existing permission service; persistent grants keep the server's actual semantics. General UI, language and voice device preferences remain app-wide. Hide subagents defaults to true when missing; a saved false is retained.

Chat focus, terminal target and Settings inspection target are independent composite references. The presentation map holds composer text/attachments, failed input, editor baseline/current text and transcript offsets. Hidden dirty drafts and PTYs participate in update blocking. Removing a connection names unsaved drafts in its confirmation. Drafts are intentionally not written to disk.

New chat creation is provider-owned: `createChat(target)` resolves and connects the target runtime, creates and opens the session there, then selects that workspace so the Chat screen follows it. The New chat sheet only holds a local draft target; no project is selected and no session is created before confirmation.


## Voice and response onboarding preferences

The optional Voice & Responses step writes through `updateChatPreferences`, using
existing voice input, local command-model, TTS pack/speaker, OS voice, auto-play,
confirmation, wake-required, response scope and next-action fields. There is no
separate onboarding draft, persistence key, schema change or completion-version
increase. Skip advances without undoing earlier selections. The step is available
without a connection.

`confirmVoiceCommands` defaults to true for new and migrated preferences. It gates
only conversation-mode voice commands; normal chat dictation still inserts text
into the composer. `wakePhraseRequired` also defaults to true. When false,
conversation mode starts in `listening` and re-arms after each reply; confirmation
remains the submission gate. Neither setting starts background listening, and
system recognition shows the vendor-privacy warning when the wake phrase is off.

Opening model setup does not download or activate a missing TTS pack. Downloads
and enrollment use the existing setup hooks, and activation still requires an
installed model. The onboarding voice panel unmounts when its route loses focus,
so preview playback and enrollment capture are released before the next screen.

## Guided on-device voice setup

The input/playback tab can temporarily show an unprepared local engine while the
active preference remains System. Opening setup is read-only; language/model
choices, permission, download, profile actions and Done are explicit writes.
Done requires ready voice models and microphone permission before setting
`voiceWakeMode: local`. Cancel leaves the active mode unchanged. Existing
installed packs and saved profiles are reused and survive dismissal.

A newly skipped voice profile writes `localSpeakerVerification: false`; recording
a profile preserves the current verification preference, which its switch edits
explicitly. Reviewing an existing profile preserves its verification setting. Removing a profile explicitly disables it.
Step progress, selected unprepared tabs and test feedback are not persisted.

Local input reads/requests recording permission independently of OS speech
recognition permission. The provider-owned wake test has busy, idle, starting,
listening, detected and error states, no transcript and no prompt callback. A
generation guard prevents dismissed/backgrounded starts from restoring listening.
Enrollment uses the same cancellation principle before saving embeddings.
