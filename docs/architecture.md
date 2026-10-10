# Architecture

## High-Level Shape

The app uses a simple structural pattern:

- Expo Router provides navigation and screen composition.
- `OpencodeProvider` owns nearly all domain state and orchestration.
- Screens are thin and read/write provider state through narrow domain hooks
  (`useChat()`, `useProjects()`, `useConnection()`, ...).
- Service modules under `providers/services/` isolate a small amount of API aggregation logic.
- `lib/` contains protocol helpers, formatting, notifications, and voice utilities.
- `components/` contains UI composition only, with very little business logic except local presentation state.

This means the real application architecture is not screen-centric. It is provider-centric.

## Top-Level Runtime Composition

`app/_layout.tsx` sets up the root runtime tree:

1. `SafeAreaProvider`
2. `OpencodeProvider`
3. `PaperProvider`
4. React Navigation `ThemeProvider`
5. Expo Router stack with `(tabs)` as the only visible route group

The same root layout also lazily initializes two side-effect systems on non-web, non-E2E runs:

- notifications via `lib/notifications`
- voice audio mode via `lib/voice/speech-output`

That makes the root layout responsible for app shell concerns only. It does not hold feature state.

`app.config.ts` extends the generated Android `MainActivity` to disable system
content capture on Android 10+ during `onCreate`. This avoids content-capture
accessibility-node traversals over the app's text hierarchy; screen-reader
accessibility and screenshots remain available. The API supports the current
target SDK (36); revisit this opt-out before targeting SDK 37, where Android
deprecates `setContentCaptureEnabled` for newly targeted apps.

## Navigation Architecture

The app has one tab group in `app/(tabs)/_layout.tsx`:

- `index` -> Chat
- `workspace` -> Workspace
- `settings` -> Settings
- `terminal` -> Terminal

Navigation complexity is deliberately low. There are no nested feature stacks, no per-screen providers, and no deep in-app route hierarchy.

This matters because state continuity is expected across tabs. Switching tabs does not reset active session context.

Bottom tabs remain in layout while typing (`tabBarHideOnKeyboard: false`).
Keyboard visibility events must not remove and restore the tab bar's layout
space alongside screen-level padding adjustment. Depending on native window
resizing, tabs may stay visible above the keyboard or be covered by it. This
removes a suspected layout-feedback path for issue #62; physical-device
validation is still required to establish whether it resolves the flicker.

## Core Architectural Principle

The dominant design decision is central orchestration through `providers/opencode-provider.tsx`.

This file is the application's effective domain layer. It owns:

- connection settings and connection state
- workspace catalog and active project selection
- session lists and session status tracking
- current session selection and data refresh
- transcript, diff (turn + VCS scopes), and todo caches
- session-scoped permission and question queues refreshed by events and list APIs
- provider/model/agent capability discovery
- chat preference management
- prompt send / abort lifecycle
- conversation mode state machine
- notification completion tracking
- global SSE subscription with reconnect and polling fallback
- session lifecycle actions, slash commands, workspace inspection, and diagnostics
- archived-session, worktree, MCP, and PTY terminal orchestration
- persistence hydration and write-back

If this app were reimplemented, this provider would be the main source of truth for required behavior.

Its public contract is split into domain contexts (`providers/opencode-contexts.ts`
+ the `*ContextValue` types): onboarding, connection, diagnostics, capabilities,
preferences, projects, workspace files, current session, session library, chat,
approvals, conversation, terminal, MCP, and app updates. The provider still
owns all the state and actions; each domain value is memoized and rendered as its
own context, so a consumer only re-renders when the domain it reads changes and
each screen declares its real dependencies instead of pulling from one
combined domain surface. `OpencodeContextValue` remains only as the documented union
of those domains.

## Module Map

### App Shell

- `app/_layout.tsx`
  Root providers, theming, side-effect bootstrap, hydration splash, and the
  onboarding/app routing gate described below.
- `app/(tabs)/_layout.tsx`
  Bottom tabs only.
- `app/onboarding/_layout.tsx`
  Nested stack for the first-run setup assistant.

### First-Run Onboarding

The assistant has five steps: app presentation, permissions, add connection,
workspace, and ready. Presentation has only Continue navigation; preferences
and provider setup remain in Settings.

- Completion lives in `opencode-mobile.onboarding-version` (managed by
  `providers/onboarding-state.ts`) and represents completion only. Connection
  settings, passwords, active workspace, chat preferences, and OS permissions
  stay in their existing stores.
- `app/_layout.tsx` keeps the native splash up until `isHydrated`, then uses
  `Stack.Protected` to register either `(tabs)` + `session/[id]` (completed) or
  `onboarding`. Review mode (`onboardingActive`) registers both, so re-running
  the assistant from Settings never unmounts the tab navigator.
- The boot connect effect is suppressed until onboarding is completed, so a
  fresh install never silently connects to the default loopback URL. Any
  explicit `runConnect` also satisfies the one-time boot connect, which stops
  completion from triggering a duplicate reconnect.
- The assistant reuses existing infrastructure: `switchConnection` for the
  server step, `selectProject`/`addWorkspace` for the workspace step,
  and `useNotificationSetup`/`lib/voice/permissions.ts` for permissions.
- Every configured step can be skipped: connect and workspace each expose a
  `skip` action that advances one step without persisting anything, matching
  the permissions skip. Skipping never mutates
  settings, so a setup can be completed with no server or workspace and the
  app lands on the chat workspace prompt, where the user can configure later.

### Screens

- `app/(tabs)/index.tsx`
  Chat landing logic. Ensures a session exists and renders `ChatView` once available.
- `app/(tabs)/workspace.tsx`
  Scoped folder browsing and search, shared workspace/worktree picker, and conflict-checked text file editing.
- `app/(tabs)/settings.tsx`
  Settings screen controller for connection, providers, MCP servers, notifications, and voice.
- `app/(tabs)/terminal.tsx`
  Thin Terminal-tab route for creating, opening, using, and terminating interactive project PTYs.
- `app/session/[id].tsx`
  Session deep-link resolver. Parses `sessionId`, `project`, and optional
  `connectionScope`, delegates to `openDeepLinkSession()`, then replaces onto
  the Chat tab. Connection switching and credential resolution stay in the provider.
- `app/onboarding/*.tsx`
  First-run setup assistant steps (presentation, permissions, connect,
  workspace, ready). Thin controllers over provider state; they do not own
  connection/workspace/preference persistence.

### Provider Layer

- `providers/opencode-provider.tsx`
  Main orchestrator and context source.
- `providers/opencode-provider-types.ts`
  Shared public types, the domain context values, and their union.
- `providers/opencode-contexts.ts`
  The domain contexts and their `use*` hooks.
- `providers/opencode-preferences.ts`
  Chat preference shape, defaults, and the derived system prompt.
- `providers/opencode-capabilities.ts`
  Server capability flags and the auto-approve permission policy.
- `providers/opencode-model-selection.ts`
  Model/agent catalog shapes and pure provider/model selection rules.
- `providers/opencode-provider-utils.ts`
  Small provider-agnostic helpers (project labels, pending-request grouping).
- `providers/opencode-provider-selectors.ts`
  Derived selectors extracted from the provider body.
- `providers/use-opencode-provider-state.ts`
  The provider's core state, latest-ref bridges, and connection-generation
  counters, returned as one flat object.
- `providers/opencode-provider-effects.ts`
  Provider lifecycle effects: language sync, active-session seeding, boot
  connect, refresh fan-out, chat bootstrap, transcript pruning, and working
  sound.
- `providers/opencode-provider-events.ts`
  Pure global-event dispatch (`handleProviderEvent(event, actions)`), kept
  testable outside React.
- `providers/opencode-provider-values.ts`
  Derived selectors and the memoized domain context values rendered by
  `OpencodeProvider`.
- `providers/use-workspace-actions.ts`
  Workspace catalog, project selection, session/file refresh, file
  search/read/save, and diagnostics actions.
- `providers/use-workspace-browser.ts`
  Scoped directory/search snapshots and request-order guards, composed by the
  workspace file actions and exposed as one files-context member.
- `providers/use-session-actions.ts`
  Session lifecycle, favorites, permissions/questions, and
  `ensureActiveSession`.
- `providers/use-prompt-lifecycle.ts`
  `sendPrompt`/`abortSession`, the submission guard, and task-completion
  notification tracking.
- `providers/use-prompt-inbox.ts`
  OpenCode 2 prompt admission and session-scoped pending messages. Wraps the
  existing transcript refresh to reconcile inbox delivery through SSE and polling.
- `providers/use-capabilities-actions.ts`
  Chat capability discovery, provider auth/OAuth, and auto-approve.
- `providers/use-connection-actions.ts`
  Connect/switch/profile orchestration, deep-link restore, and session
  restore.
- `providers/connect/`
  Cloud Link pairing, subscription, and access state machine
  (`use-connect-machine.ts`), with catalog discovery (`catalog.ts`), purchase
  finalization/recovery (`purchases.ts`), pairing link handling (`pairing.ts`),
  and access credential preparation (`access.ts`); re-exported through
  `providers/use-connect-state.ts`.
- `providers/conversation/`
  Conversation listening, playback, connection-feedback, and shared feedback
  helpers composed by `providers/use-conversation-state.ts`.
- `providers/use-opencode-persistence.ts`
  AsyncStorage hydration and ordered write-back, with field validation in
  `providers/persisted-preferences.ts`.
- `providers/use-connection-profiles.ts`
  Provider-owned saved-profile state, credential ordering, mutation serialization,
  hostname defaults, setup probing, local V2 pairing, and connection actions
  exposed through `useConnection().connectionProfiles`. Setup probes never switch
  the active connection; saving an edit does not reconnect.
- `providers/use-conversation-state.ts`
  Conversation phases, speech submission, reply playback, timers, and cleanup.
- `providers/use-opencode-realtime.ts`
  SSE transport/backoff, first-connect and reconnect reconciliation, and the
  safety poll (5s disconnected, 10s while SSE is connected). Domain event handling stays in the provider.
- `providers/session-cache.ts`
  Per connection + project session/status cache DTO, validation, and hydration.
- `providers/favorites-storage.ts`
  Favorites DTO validation, bounded serialization, and legacy-entry migration.
- `providers/use-conversation-keep-awake.ts`
  Keeps device awake during conversation mode.
- `providers/use-terminal-state.ts`
  Project-scoped PTY list and retained per-PTY transports, connect tickets,
  reconnect, renderer registration, cursor acknowledgements, and resize.
  `terminal-connection.ts` owns each connection lifecycle; protocol decoding
  and bounded output delivery live in `lib/opencode/terminal-stream.ts`.
- `providers/use-mcp-state.ts`
  MCP server status plus its lifecycle actions.
- `providers/use-permission-rules-state.ts`
  V2 saved "always allow" rules: list, refresh, and remove, connection-scoped
  like the rest of the provider state.
- `providers/use-worktree-state.ts`
  Project-scoped worktree inventory, owning project identity, and guarded lifecycle actions.
- `providers/use-active-sessions.ts`
  Connection-wide running/recent session snapshot for the Chat Library. Reads the
  unscoped catalog client, seeds on connect and on library open, polls every 20
  seconds only while the Chat Library is open and a session is running, and tags
  the snapshot with its connection scope so a server switch hides the previous
  server's sessions.
- `providers/active-sessions.ts`
  Pure selection of the active-session group (running-first ordering, recent tail
  capped at four, subagent/archived filtering). The Chat Library de-duplicates
  these IDs out of the current-workspace Chat list.
- `providers/use-transcript-state.ts`
  Paginated transcript window state machine: newest-page load on open, scroll-up
  history paging, bounded-window tail merge, and accumulation of session usage
  steps and V2 `todowrite` records so a bounded window keeps exact totals.

MCP and worktree callback bridges use stable callbacks backed by the provider's
latest refs. Conversation submission similarly uses the latest send action
without restarting a submitted turn when message state changes.

These domain hooks are composed by `OpencodeProvider`, which stays the single
orchestrator. Each hook receives the current client (and, when it must call a
later-defined provider callback, a latest-ref) and exposes its own reset, so the
provider's project/connection reset composes them instead of inlining state.

`test:architecture` enforces a repo-wide readable-size ratchet: every source
file under `app/`, `components/`, `providers/`, and `lib/` must stay at or below
**500 lines** (200-400 is the target; generated `lib/i18n/resources.ts` is
exempt), the provider stays at or below 500, and the public context surface
cannot grow past 135 members. When a limit is genuinely outgrown, split the file
into the right layer and, if needed, lower the number in the same change.

### Services

- `providers/services/session-service.ts`
  Fetch sessions, messages, diffs, todos, commands, and perform session lifecycle actions. Also lists the cross-workspace active-session snapshot through an unscoped client.
- `providers/services/capabilities-service.ts`
  Discover config, providers, provider auth methods, model capabilities, and agents.
  Catalog and speech-voice label sorting share `lib/compare-labels.ts`'s
  `Intl.Collator`, avoiding a native collator allocation per comparison on Hermes.
- `providers/services/workspace-service.ts`
  File search/read/status, VCS patch, and experimental worktree requests.
- `providers/services/mcp-service.ts`
  MCP status, lifecycle, config enablement, and OAuth requests.
- `providers/services/terminal-service.ts`
  PTY lifecycle, shell discovery, connect-token, and WebSocket URL helpers.
- `providers/services/diagnostics-service.ts`
  Health, MCP, LSP, and formatter diagnostics with per-endpoint availability.

### OpenCode Protocol Helpers

- `lib/opencode/client.ts`
  Builds either the OpenCode 1.x SDK client or the V2 adapter. The barrel re-exports the connection helpers now split by concern under `lib/opencode/client/` (`types`, `url`, `fetch`, `errors`, `probe`, `interactions`); URL normalization, basic auth, path-prefix handling, transport, contract probing, and pending-interaction calls each live in one module.
- `lib/opencode/v2-client.ts`
  OpenCode 2.x adapter over `@opencode/client`. Keeps the `buildV2Client` entrypoint and error wrapping; the V1-shaped client is re-assembled from per-domain builders so a protocol change touches one builder.
- `lib/opencode/v2/`
  The 2.x adapter's per-domain builder modules (`raw`, `project`, `session`, `capabilities`, `filesystem`, `vcs`, `worktree`, `mcp`, `pty`, `global`, `interactions`), plus shared protocol types/helpers (`shared`), response mappers (`mappers`), and event mapping (`events`). Normalizes V2 responses and events back into the app's 1.x-shaped domain types and reports unsupported features explicitly.
- `lib/opencode/format.ts`
  Barrel over `lib/opencode/format/` (`types`, `tool`, `time`, `preview`, `todos`, `window`, `transcript`). Converts raw message records into transcript entries, previews, todos, and windowed history.
- `lib/opencode/transcript.ts`
  Transcript activity helpers and display filtering.
- `lib/opencode/types.ts`
  Direct aliases for generated v2 SDK protocol types.

### Connection Identity And Credentials

Manual setup shares a two-step address/details dialog between Settings and
onboarding. Components own fields, step changes and the native camera surface;
the provider owns probe/pair/save/connect actions. `lib/opencode/client/probe.ts`
preserves setup detection uncertainty while retaining the existing connect-time
fallback. `lib/opencode/pairing.ts` validates local QR formats and redeems V2
one-use codes, independently of Cloud Link subscriptions. The resulting session
token uses the existing per-profile password storage and Basic-auth transport.

The optional native Cloud Link method composes `use-connect-state.ts`
inside the provider, verifies native subscriptions through the Cloud Link service,
validates catalog/session/pairing protocol in `lib/connect.ts`, and
activates Basic-auth profiles through `switchConnection()`. Shared connection
preparation refreshes credentials on the same owned machine; expiry preserves
profiles and renewal migrates state to the rotated credential scope. The `pair` route is
independent of onboarding completion. See [Cloud Link pilot](connect.md).

- `lib/connection-scope.ts`
  Canonical, deterministic, password-free connection identity (`getConnectionScope`). Every server-scoped storage key, favorite, and pending notification record derives from it; scheme/host are normalized while URL path and query casing are preserved.
- `lib/connection-profiles.ts`
  Saved connection metadata in AsyncStorage, per-profile passwords in SecureStore, whole-DTO validation, and credential resolution for a connection that is not currently active.
- `lib/connection-password.ts`
  Active connection password in SecureStore, including legacy plaintext migration.
- `lib/notification-pending.ts`
  Explicit non-secret pending-notification DTO, parsing, and composite keying.

### Chat UI

- `components/chat/chat-view.tsx`
  Main chat screen render, driven by `components/chat/use-chat-view-controller.ts` and `components/chat/use-chat-view-actions.ts`.
- `components/chat/chat-content.tsx`
  Barrel over `components/chat/content/` (transcript list, changes overlay, pending interactions, skeleton).
- `components/chat/chat-composer.tsx`
  Prompt input, attachments, and controls.
- `components/chat/chat-header.tsx`
  Session picker and conversation overlay mount point.
- `components/chat/chat-cards.tsx`
  Barrel over `components/chat/cards/` (message, diff, session-diff, permission, question-flow cards).
- `components/chat/chat-markdown.tsx`
  Memoized GFM renderer backed by `react-native-enriched-markdown`.
- `components/chat/chat-overlay.tsx`
  Full-screen conversation mode overlay.

### Settings UI

- `components/settings/settings-sections.tsx`
  Barrel over `components/settings/sections/` (diagnostics, connection, AI defaults, notifications, voice, language, appearance) plus `setting-rows.tsx`.
- `components/settings/provider-config-dialog.tsx`
  Provider auth modal.
- `components/settings/settings-utils.ts`
  Provider copy and option lists.

### Platform Integrations

Android activity notifications are orchestrated by `use-activity-notifications`
inside the provider. The observer reads the connection-wide catalog through
the existing session service, receives global events before workspace filtering,
and polls independently of the Chat Library. `providers/services/activity-service`
aggregates scoped interaction, inbox, and newest-transcript reads; activity
selection folds descendants into their root tasks. No screen owns this state.

The local Expo module in `modules/opencode-activity` owns the Android notification
and a `dataSync` foreground service. Its Headless JS task only keeps React Native
timers alive; network reads and lifecycle decisions remain in the provider.
`index.js` registers that task before loading Expo Router. Native sources are
autolinked from `modules/` and survive a clean prebuild. iOS, web, Expo Go, and
E2E runs do not start this service.

- `lib/notifications.ts`
  Local notifications, background monitoring task, and notification debug status.
- `lib/voice/speech-output.ts`
  Text-to-speech, audio ducking, stale-voice fallback, and a completion watchdog
  so a silent native failure cannot hang callers.
- `lib/voice/use-speech-input.ts`
  Speech recognition hook. Re-checks recognition availability at start, pins an
  explicit iOS audio session category, and retries once through network
  recognition when an on-device attempt fails.
- `lib/voice/speech-errors.ts`
  Pure error classification into a message plus a recovery action
  (`retry`, `open-settings`, `none`).
- `lib/voice/capabilities.ts`
  Read-only recognition capability snapshot (permission, availability,
  on-device support) for onboarding and the Settings voice check.
- `lib/voice/permissions.ts`
  Voice permission reads/requests plus the app-settings deep link.
- `lib/voice/working-sound.ts`
  Generated looping working sound.

### Internationalization

- `lib/i18n/index.ts`
  i18next initialization, device-locale detection via `expo-localization`, and the persisted-preference sync.
- `lib/i18n/languages.ts`
  Supported language list plus pure preference/device-tag resolution.
- `lib/i18n/resources.ts`
  Generated, static namespace registry per language (no runtime loading).
  Regenerate with `npm run gen:i18n`; `test:i18n` fails when it is stale.
- `lib/i18n/locales/<lang>/<namespace>.json`
  Committed translation files; English is the source of truth and fallback.
- `lib/i18n/index.ts`
  Also exports `getFormatLocale()`, which `lib/opencode/format.ts` uses to render
  timestamps and relative times in the active language.

UI text is grouped into feature namespaces (`common`, `chat`, `workspace`,
`terminal`, `settings`, `notifications`). Components translate with
`useTranslation()` and explicit namespace prefixes. The root layout imports
`lib/i18n` so translations are initialized before first render, and
`OpencodeProvider` applies the persisted language preference after hydration.

Domain-generated labels (`lib/opencode/format.ts` detail labels,
`lib/opencode/transcript.ts` activity summaries, and provider/transport error
strings) remain English. They are built outside the React tree and are partly
memoized per message record, so translating them needs a by-kind/enum pass
rather than an in-place `t()` call. Notification copy is the exception: it is
translated inside `lib/notifications.ts`, so the provider passes only the
session title and never builds notification strings itself.

## Runtime Boot Sequence

The normal startup flow is:

1. Root layout mounts providers and keeps the native splash up.
2. `useOpencodePersistence()` hydrates settings, chat preferences, active project, the connection-scoped last-session map, and the onboarding completion marker from AsyncStorage.
3. The routing gate resolves: existing configured installs show `(tabs)`; a fresh install shows the onboarding assistant. A fresh install does not auto-connect.
4. After hydration, once onboarding is completed, `OpencodeProvider` calls `connect()`.
5. `connect()` loads workspace catalog using a catalog-scoped client with no directory.
6. Connection state becomes `connected` or `error`.
7. If a project exists, the provider fetches sessions and chat capabilities.
8. A follow-up effect calls `ensureActiveSession()` for the active project.
9. `ensureActiveSession()` honors a transient deep-link target (set by `openDeepLinkSession`), then reopens the remembered session, falls back to the newest returned session, or creates a new one. A deep-link target that does not match any session never triggers session creation.
10. The Chat tab can then render transcript, diffs, todos, pending interactions, and controls.

When the app is launched from (or navigated to) a session deep link, the dedicated resolver route `app/session/[id].tsx` parses `sessionId` + `project`, calls `openDeepLinkSession()`, and replaces onto the Chat tab where the session is already current.

This boot chain is important because the Chat screen itself is not responsible for initial data ownership. It only triggers `ensureActiveSession()` when the provider has enough context.

## Client Topology

The provider creates two client instances:

- `client`
  Bound to `settings` plus `activeProjectPath`. Used for session-scoped calls.
- `catalogClient`
  Bound to `settings` with an empty directory. Used for workspace discovery, diagnostics, and the global event stream.

This split is one of the key architectural details. Workspace discovery is intentionally decoupled from a selected project directory.

### Connection Switching

Saved connections are a first-class concept built on `getConnectionScope()`. A
switch is deliberately ordered:

1. persist the outgoing profile's model preferences,
2. update credentials and settings, which resets every server-derived in-memory slice,
3. restore the target profile's model preferences (validated again by capability discovery after connecting),
4. reconnect with the target settings passed explicitly to `runConnect()` instead of reading a render-delayed ref, then
5. hydrate only state whose connection scope matches the new settings.

Persisted session caches, remembered sessions, favorites, and pending
notifications are all keyed by connection scope, so a switch can never surface
or mutate another server's state even when both servers expose the same project
path.

## Data Flow Model

### Server -> Provider

The provider fetches and caches:

- workspace catalog
- sessions and statuses
- messages per session
- diffs per session plus workspace VCS diffs (`uncommitted`/`branch`), selected by Files Changed scope
- todos per session
- pending permissions and questions by session, populated by events and refreshed from the server
- providers, models, and agents
- commands, workspace file status/search/read data, VCS information, and diagnostics
- archived sessions, worktrees, MCP statuses, PTYs, terminal connection state, and terminal output
- a connection-wide session snapshot (all sessions + statuses) from the unscoped catalog client, used by the Chat Library "Active" group. The global SSE stream still filters events to the active project, so this snapshot is refreshed on connect, when the library opens, and by a 20-second poll while a session is running.

### Provider -> Derived State

Selectors transform provider state into:

- current transcript
- session preview text
- visible configured providers
- current permissions and questions scoped to the active or sending session
- conversation status label

### Provider -> UI

Screens and components consume one context and render local presentation states.

### UI -> Provider

User interactions are converted to provider actions such as:

- `connect`
- `selectProject`
- `createSession`
- `openSession`
- `openDeepLinkSession`
- `sendPrompt`
- `abortSession`
- `replyToPermission`
- `replyToQuestion` and `rejectQuestion`
- `deleteSession`, `renameSession`, `forkSession`, `revertSession`, and share actions
- `executeCommand`
- workspace search/read and diagnostics refresh actions
- workspace patch save, archive/restore, worktree, MCP, and terminal actions
- `setProviderAuth`
- `toggleConversationMode`
- `completeOnboarding`, `startOnboardingReview`, and `stopOnboardingReview` (first-run setup completion and Settings re-entry)

## Real-Time Update Architecture

The app uses two update strategies in parallel:

### Primary Strategy: SSE Subscription

When connected and a project is active, the provider opens `catalogClient.global.event()`. Global event envelopes are filtered by `directory === activeProjectPath` before their payload is handled. If the stream ends or fails, the provider reconnects indefinitely with exponential backoff from 1 second to 15 seconds.

Recognized events update local state or schedule refreshes for:

- session creation/update/deletion
- session status changes
- session idle completion
- message updates
- message part updates/removals/deltas
- session diff updates
- todo updates
- permission and question requests/replies
- capability/config, project-directory, VCS, LSP, worktree, MCP, and terminal changes
- MCP authentication failures (`mcp.browser.open.failed`), surfaced as an in-chat approval alert

### Safety Strategy: Polling Fallback

The provider keeps a safety polling loop when any of the following is true:

- SSE is not connected
- any session is non-idle
- a prompt is currently being submitted
- conversation mode is active

While SSE is connected the loop runs every 10 seconds; without a stream it is the
primary transport and runs every 5 seconds. A submitted prompt also schedules a
one-off transcript refresh 5 seconds after send, so a completion whose event is
missed (for example from another workspace) still lands even with the slower
connected cadence. Polling refreshes sessions, current/conversation session
content, and pending interactions as needed. The `/permission` and `/question`
list APIs recover requests missed by SSE.

`permission.asked` and `question.asked` insert requests under their `sessionID`; reply and rejection events remove them. Opening or refreshing a session reconciles both maps with the server. Because subagents run in child sessions, a blocking request may carry a descendant `sessionID`; the active chat surfaces the full `parentID` subtree of the current/sending session so nested prompts are shown rather than dropped.

This dual model is critical. The implementation does not trust SSE alone.

## Screen Responsibilities

### Chat Screen

`ChatView` is the main operator surface.

Responsibilities:

- render session transcript
- render pending permission and question interactions inline
- render the changes overlay with turn/uncommitted/branch scopes and a turn picker
- send prompts and attachments
- suggest and execute server-provided slash commands
- fork from or revert to a user message, and undo a session revert
- toggle auto-approve
- select agent/model/reasoning
- start/stop microphone dictation for the draft box
- start/stop conversation mode
- play assistant replies via TTS
- abort running sessions
- create and switch sessions

### Workspace Screen

Responsibilities:

- retain the Workspace tab and route, with Files as the main surface
- browse folders and navigate breadcrumbs inside the selected directory
- search across the active workspace, preview text, and retain the browsed folder on return
- preserve conflict-checked text editing and confirm before discarding unsaved edits
- show supported changed-file information and the current VCS branch
- refresh the current folder or search, file status, and workspace catalog together
- use the shared workspace picker for project/worktree selection and worktree management

### Settings Screen

Responsibilities:

- configure the active connection (server URL, username, password) from its row and reconnect manually; editing applies only after Reconnect
- add, edit, and delete named connection profiles, and switch between them from the connection list; switching persists the outgoing profile's model selection, restores the target profile's selection, and reconnects with that profile's credentials
- inspect server health, realtime status, LSP, and formatter counts
- add local or remote MCP servers; connect, disconnect, enable, disable, and complete remote OAuth
- configure providers
- remove configured provider credentials
- choose model enablement defaults
- inspect and enable notification setup
- manage voice and response-style preferences
- adjust the chat transcript text size, bubble/flat layout, and slim interface density
- choose the app interface language
- group chat text size, flat conversation and V2 Steer/Append delivery under Advanced → Editor; group slim interface, language and Reset onboarding under Advanced → General
- launch Reset onboarding at the presentation screen, with the permissions, connection and workspace steps seeded from current state without wiping configuration

### Terminal Screen

Responsibilities:

- list available shells and project PTYs
- create, open/reconnect, and terminate PTYs
- request a short-lived connect ticket and stream PTY data over a project-scoped WebSocket
- provide xterm terminal emulation with immediate input and a system-keyboard accessory

The provider delivers raw VT output in ordered acknowledged batches to xterm. It owns reconnect cursors, resize, and per-PTY transport lifetime; xterm owns the display and 10,000-line scrollback.

## Conversation Mode Architecture

Conversation mode is a provider-level state machine with phases:

- `off`
- `listening`
- `submitting`
- `waiting`
- `speaking`

Supporting behaviors include:

- continuous speech recognition
- final-result settling delay before submission
- automatic assistant reply playback
- optional automatic return to listening after playback
- keep-awake activation
- blocking if pending permissions or questions exist
- cancellation and cleanup across timers, speech input, TTS, and working sound

This is one of the densest parts of the architecture and would need careful parity in any rewrite.

## Presentation Architecture Notes

- Input screens and full-screen forms use `KeyboardAvoidingView` with `padding`
  on all platforms. Android retains native `adjustResize`
  (`android.softwareKeyboardLayoutMode: 'resize'`), but edge-to-edge layout does
  not guarantee root resizing, so avoidance must remain enabled. Padding handles
  keyboard overlap while preserving the outer flex frame; explicit `height`
  adjustment can feed IME/layout changes back into each other with
  hardware-keyboard toolbars.
- Chat and Terminal avoidance starts at the screen origin; their headers already
  apply the top safe-area inset, so no keyboard vertical offset is added.
- The app is not orientation-locked. Screens must lay out in portrait and
  landscape and under Android 16's large-screen resize behavior; safe-area
  insets are applied at the screen/header level.
- Bottom overlays follow the same `padding` rule: `OverlaySheet` uses a stable
  full-screen `KeyboardAvoidingView` around a shrinking sheet and scroll area,
  while transparent `Modal` sheets (`native-select`,
  model picker) cannot use `KeyboardAvoidingView` and instead consume
  `hooks/use-keyboard-height.ts` and apply the inset as padding. Neither uses
  `behavior="height"`.
- The app uses custom theme tokens from `constants/theme.ts` and maps them into React Native Paper in `constants/paper-theme.ts`.
- Markdown rendering is intentionally narrow and custom, not library-based.
- Diff rendering is custom and optimized for readable in-app inspection, not full git-style fidelity.
- The chat area surfaces server-owned todos in a collapsed overlay with read-only status icons. It does not mutate todo state.
- Working sound is started by the provider while a send or any session is busy, when enabled, except during listening and speaking phases.

## Architectural Hotspots

The highest-coupling areas are:

### `providers/opencode-provider.tsx`

This is the main behavioral hotspot. Changes here can affect nearly every screen.

### Prompt lifecycle

`sendPrompt()`, notification tracking, session refresh, summarization, attachment capability checks, and attachment encoding are tightly coupled.

### Conversation mode

It spans provider state, timers, speech recognition, TTS, keep-awake, and chat state.

### Capability refresh

Provider/model/agent choices depend on server config, configured providers, current preferences, and stored selections.

## Reimplementation Guidance

If the system is rebuilt, the safest parity-preserving architecture would keep these concepts intact:

- one central orchestration layer
- a separate workspace-discovery client from a project-scoped session client
- combined SSE + polling safety net
- persisted connection/preferences/project/session identity state
- transcript model derived from raw message parts rather than storing rendered text only
- explicit conversation mode state machine
- event-driven handling for session-scoped permission blocking flows

Those are implementation-defining patterns, not incidental details.


## Session library recovery (#64)

Session idle events only refresh domain state; archiving remains an explicit user action. Archive restoration and optional reopening are provider-owned and preserve the target workspace and connection scope.

## Interactive Terminal

The Terminal route delegates presentation to `components/terminal/`. One Expo
DOM surface bundles xterm and its fit addon locally, containing a retained xterm
instance for each opened PTY. The surface stays mounted across tab and PTY
switches. Emulator buffers and keyboard modifiers are presentation state;
transport, credentials, scope, reconnect, and server mutations remain provider-owned.

The system keyboard enters xterm directly. Its DOM accessory supplies Esc, Tab,
sticky Ctrl/Alt/Shift, arrows, and an expandable function/navigation/paste row.
The existing padding keyboard avoidance and persistent bottom-tab layout remain.
There is no separate line composer or local shell-history implementation.

The native DOM bridge has void imperative methods, so each output batch carries
an acknowledgement ID. The DOM replies only after xterm parses the batch.
Provider resume cursors advance after that acknowledgement; growing output is
never a React prop. Connection generations and scope IDs reject stale input.
No credentials or socket URLs cross into the DOM surface.

## Workspace file browser

Workspace retains its tab label and route. Files is its main surface: the provider
owns the current relative directory, sorted folder/file entries, submitted search,
results, loading/error state and request-order guards. It retains the directory
across tab switches and resets on scoped-client changes; it is not persisted.
Search spans the selected workspace root and clearing it restores the browsed
folder. Breadcrumb navigation cannot leave that root. Listing, search, preview
and save require a selected directory. The OpenCode 2 filesystem adapter passes
`location[directory]` on every request and rejects malformed UTF-8/binary content.
Text editing retains the existing conflict-checked patch path and is unavailable
on OpenCode 2. Unsaved edits require discard confirmation.

The shared Workspace/Chat picker contains worktree inventory for the owning
project, resolved from the scoped project API rather than path prefixes. Directory
selection uses the existing provider workspace action and applies across Chat,
Workspace and Terminal. Creation stays in the picker; reset/remove live in row
menus, preserve confirmations and reject the active directory and primary checkout.
OpenCode 2 hides reset/startup commands and maps directory-only inventory to names.
The browser groups state and actions under one context member, keeping the public
context below the 135-member ceiling. Screens and components call provider actions;
services and protocol modules own requests and response normalization.

## App update integration

The existing provider owns `useAppUpdates` and its `useUpdates()` domain hook.
The root shell renders the notice; local UI registers busy presence through
`useUpdateBlocker`, retaining its own contents. `lib/app-updates.ts` wraps the local
Expo module and iOS lookup. See [app updates](app-updates.md) for install consent,
safety gates and FOSS exclusion.
