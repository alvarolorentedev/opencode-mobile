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
- `project` -> Project
- `settings` -> Settings
- `terminal` -> Terminal

Navigation complexity is deliberately low. There are no nested feature stacks or deep in-app route hierarchy. Terminal and Settings use provider scope boundaries so inspecting a server or opening a PTY does not move the selected chat.

This matters because state continuity is expected across tabs. Switching tabs does not reset active session context.

Bottom tabs remain in layout while typing (`tabBarHideOnKeyboard: false`).
Keyboard visibility events must not remove and restore the tab bar's layout
space alongside screen-level padding adjustment. Depending on native window
resizing, tabs may stay visible above the keyboard or be covered by it. This
removes a suspected layout-feedback path for issue #62; physical-device
validation is still required to establish whether it resolves the flicker.

## Core Architectural Principle

The dominant design decision is central orchestration through the provider layer:
`providers/opencode-provider.tsx` mounts `WorkspaceProvider`, which owns the connection registry and app-wide coordinators. Each retained connection/project branch mounts a headless `WorkspaceRuntime`, reusing `use-opencode-provider-composition.ts`. `WorkspaceScope` supplies its existing narrow domain contexts to the selected surface.

This composition unit is the application's effective domain layer. It owns:

- connection settings and connection state
- project catalog and active project selection
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
- session lifecycle actions, slash commands, project inspection, and diagnostics
- worktree, MCP, and PTY terminal orchestration
- persistence hydration and write-back

If this app were reimplemented, this provider would be the main source of truth for required behavior.

Its public contract is split into domain contexts (`providers/opencode-contexts.ts`
+ the `*ContextValue` types): onboarding, connection, diagnostics, capabilities,
preferences, projects, project files, current session, session library, chat,
approvals, conversation, terminal, MCP, and app updates. The provider still
owns all the state and actions; each domain value is memoized and rendered as its
own context, so a consumer only re-renders when the domain it reads changes and
each screen declares its real dependencies instead of pulling from one
combined domain surface. There is no combined runtime context value.

`WorkspaceActionsContext` exposes the app-level actions and focus separately
from the changing workspace snapshot registry. The stable presentation map
(composer/editor drafts, transcript positions) lives in
`WorkspacePresentationContext`; `useRetainedState` reads it directly, so a
background workspace publish cannot invalidate a draft consumer. Chat reads
actions/focus from the actions context. The focused workspace values are built
by `useWorkspaceValues`, which memoizes each overridden domain independently;
`WorkspaceRuntime` is wrapped in `React.memo` so unchanged runtimes skip
parent-driven renders.

Connectivity is owned once by `WorkspaceProvider`. `NetInfo.configure()` is
process-global and resets previously registered listeners, so mounting
`useNetworkStatus()` per retained project would freeze every runtime except the
last one mounted. The shell samples the network once and passes the snapshot to
each runtime.

Likewise, each connection has one active-session catalog owner: the first
retained runtime reads the unscoped catalog and publishes `sessions` / `statuses`
through the shell. Other runtimes consume that snapshot, so reconnecting several
projects on one server does not issue several identical `listActiveSessions`
reads. Project transcripts, prompts, approvals, and terminal streams remain
per-runtime.

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

The assistant has eight connected steps: app presentation, permissions, add
connection, AI & Providers, project, General Settings, Voice & Responses, and
ready. Without a connection, AI & Providers and project are omitted (six visible
steps). Shared
navigation derives progress and forward/back destinations from that sequence;
temporary reconnects retain the AI step and its sign-in dialog. Manual connection
and Cloud Link pairing both continue to AI & Providers. General Settings edits
language, the remembered Chat model, and V2 Steer/Append delivery. The model
field requires a connection; delivery also requires V2.
Provider setup embeds the same composition as Settings, including auth dialogs,
model toggles, account actions, confirmations and feedback. All selections write
through existing provider actions, and Ready summarizes current provider state.
Voice & Responses reuses the Settings voice controls in an onboarding view,
including OS/on-device input, command-model setup, playback packs, voice preview,
auto-readback and response style. Model downloads and microphone permission are
explicit actions. The voice panel unmounts on blur to release native audio.
The completion version, preference schema and first-run migration are unchanged.

- Completion lives in `opencode-mobile.onboarding-version` (managed by
  `providers/onboarding-state.ts`) and represents completion only. Connection
  settings, passwords, active project, chat preferences, and OS permissions
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
  server step, `selectProject`/`addProject` for the project step,
  and `useNotificationSetup`/`lib/voice/permissions.ts` for permissions.
- Every configured step can be skipped: connect and project each expose a
  `skip` action that advances one step without persisting anything, matching
  the permissions skip. Skipping never mutates
  settings, so a setup can be completed with no server or project and the
  app lands on the chat project prompt, where the user can configure later.

### Screens

- `app/(tabs)/index.tsx`
  Chat landing logic. Ensures a session exists and renders `ChatView` once available.
- `app/(tabs)/projects.tsx`
  Scoped folder browsing and search, shared project/worktree picker, and conflict-checked text file editing.
- `app/(tabs)/settings.tsx`
  Settings screen controller for connection, providers, MCP servers, notifications, and voice.
- `app/(tabs)/terminal.tsx`
  Thin Terminal-tab route for creating, opening, using, and terminating interactive project PTYs.
- `app/session/[id].tsx`
  Session deep-link resolver. Parses `sessionId`, `project`, and optional
  `connectionScope`, delegates to `openDeepLinkSession()`, then replaces onto
  the Chat tab. Connection switching and credential resolution stay in the provider.
- `app/share.tsx`
  Inbound-share preview. Renders the provider-staged `sharedInput` (text, link,
  attachment tiles, skipped-item warnings), the shared project picker, and
  Add to chat / Discard. Thin controller: it never fetches, persists, or
  submits. `app/+native-intent.ts` routes the `expo-sharing` host here.
- `app/onboarding/*.tsx`
  First-run setup assistant steps (presentation, permissions, connect,
  project, ready). Thin controllers over provider state; they do not own
  connection/project/preference persistence.

### Provider Layer

- `providers/opencode-provider.tsx`
  Thin entrypoint: mounts the context tree with the values from the
  composition unit.
- `providers/use-opencode-provider-composition.ts`
  The orchestrator: wires the domain hooks, assembles their inputs, and derives
  the context values. This is the application's effective domain layer.
- `providers/opencode-provider-tree.tsx`
  The nested domain context providers, in their documented order
  (`UpdatesContext` innermost).
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
- `providers/opencode-auto-model.ts`
  Pure auto-routing rules: tier suggestions, explicit/automatic resolution,
  attachment/context compatibility, and the long-chat cache guard.
- `providers/use-prompt-routing.ts`
  Send-time classifier selection and tier resolution. Requires a real
  on-device or OpenCode classifier; it never falls back to heuristics.
- `providers/services/model-routing-service.ts`
  V2 OpenCode classifier probe/call (`POST /api/experimental/generate`) and
  result parsing.
- `lib/auto-model/`
  Pinned GGUF catalog, verified download/install state, llama.rn runtime, and
  prompt/grammar helpers shared by local and OpenCode classifiers.
- `providers/opencode-provider-utils.ts`
  Small provider-agnostic helpers (project labels, pending-request grouping).
- `providers/opencode-provider-selectors.ts`
  Derived selectors extracted from the provider body.
- `providers/use-opencode-provider-state.ts`
  The provider's core state, latest-ref bridges, and connection-generation
  counters, returned as one flat object.
- `providers/use-workspace-values.ts`
  Layers app-scope overrides over a runtime's memoized domain values. Each
  domain is memoized separately, so transcript updates do not invalidate
  connection, project, or onboarding contexts.
- `providers/use-coalesced-refresh.ts`
  Collapses event-driven refresh bursts into one trailing call without
  resetting the timer when callbacks are recreated.
- `providers/use-opencode-provider-effects.ts`
  Provider lifecycle effects: language sync, active-session seeding, boot
  connect, refresh fan-out, chat bootstrap, transcript pruning, and working
  sound.
- `providers/opencode-provider-events.ts`
  Pure global-event dispatch (`handleProviderEvent(event, actions)`), kept
  testable outside React.
- `providers/opencode-provider-values.ts`
  Derived selectors and the memoized domain context values rendered by
  `OpencodeProvider`.
- `providers/use-project-actions.ts`
  Project catalog, opened-project add/close, project selection, session/file
  refresh, file search/open/save/download, and diagnostics actions.
- `providers/use-project-browser.ts`
  Scoped directory/search snapshots and request-order guards, composed by the
  project file actions and exposed as one files-context member.
- `providers/use-session-actions.ts`
  Session lifecycle, favorites, permissions/questions, and
  `ensureActiveSession`.
- `providers/use-prompt-lifecycle.ts`
  `sendPrompt`/`abortSession`, the submission guard, task-completion notification
  tracking, and the initial auto-routing await. Classification starts in
  parallel with attachment preparation; a missing classifier leaves the send on
  the normal default model.
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
  `activation.ts` owns the bounded post-claim desktop-approval/startup wait,
  foreground suspension and delayed saved-profile checkpoint.
- `providers/conversation/`
  Conversation input/re-arm, wake-phrase turn gating, independent reply
  readback, connection feedback, the memoized conversation snapshot, and shared
  feedback helpers composed by `providers/use-conversation-state.ts`.
  `use-conversation-submit.ts` owns submit-then-rearm; `use-conversation-playback.ts`
  owns the separate settled-reply readback watcher, and
  `use-conversation-readback-input.ts` owns the microphone/TTS handoff.
- `providers/use-opencode-persistence.ts`
  AsyncStorage hydration and ordered write-back, with field validation in
  `providers/persisted-preferences.ts`.
- `providers/use-connection-profiles.ts`
  Provider-owned saved-profile state, UI sequencing and credential ordering,
  hostname defaults, setup probing, local V2 pairing, and connection actions
  exposed through `useConnection().connectionProfiles`. Setup probes never switch
  the active connection; saving an edit does not reconnect.
- `providers/use-conversation-state.ts`
  Conversation input/readback orchestration, wake-phrase-gated speech
  submission, immediate input re-arm, timers, and cleanup.
- `providers/use-opencode-realtime.ts`
  SSE transport/backoff, first-connect and reconnect reconciliation, and the
  safety poll (adaptive while busy; 5s/10s base by stream state, offline pause).
  The stream has a first-byte timeout, jittered backoff, stable-stream reset,
  and a 45s busy / 60s idle keepalive-based staleness window. See
  [network resilience](network-resilience.md).
- `providers/use-network-status.ts` and `lib/network-status.ts`
  Normalized online/offline, link type, metered and constrained state. Offline
  pauses retries; online restarts the stream and runs a critical reconcile.
- `providers/use-connection-retry.ts`
  Bounded, foreground-only retry for retryable connect failures (1/2/5/10/20s),
  with immediate recovery after an offline→online transition.
- `providers/transcript-cache.ts`
  Bounded, connection/project/session-scoped transcript tail used to paint a
  cold chat before the network answers.
- `providers/capabilities-cache.ts`
  Bounded last-known provider/model/agent catalog so the composer remains
  usable during a slow capability refresh or cold start.
- `lib/opencode/client/request-policy.ts`
  Per-class deadlines (read/write/stream), idempotent-read retry eligibility,
  and retryable gateway-status policy.
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
- `providers/use-extensions-state.ts`
  Server-scoped extensions domain: scoped snapshots for MCPs, plugins, skills,
  and commands; serialized mutations; safety preflight; and refresh fan-out.
- `providers/services/extensions-service.ts`
  Loads scoped extension inventories and performs backup/verify/rollback config
  mutations and skill file operations.
- `lib/opencode/extensions/`
  Pure extension helpers: config scope and target resolution, JSONC-preserving
  edits, atomic config transactions, skill file generation, and shell-safe path
  handling.
- `providers/use-permission-rules-state.ts`
  V2 saved "always allow" rules: list, refresh, and remove, connection-scoped
  like the rest of the provider state.
- `providers/use-worktree-state.ts`
  Project-scoped worktree inventory, owning project identity, and guarded lifecycle actions.
- `providers/use-active-sessions.ts`
  Connection-wide running/recent session snapshot for the Chat Library. One
  runtime per connection owns the read; the shell shares the resulting sessions
  and statuses with the other retained projects. It seeds on connect and on
  library open, polls every 20 seconds only while the Chat Library is open and a
  session is running, and tags the snapshot with its connection scope so a
  server switch hides the previous server's sessions.
- `providers/active-sessions.ts`
  Pure selection of the active-session group (running-first ordering, recent tail
  capped at four, subagent filtering). The Chat Library de-duplicates
  these IDs out of the current-project Chat list.
- `providers/use-transcript-state.ts`
  Paginated transcript state machine: one newest 200-record window on open,
  scroll-up history paging in 200-record batches without a cap, a single newest
  20-record tail merge with anchor-aware placement, a read generation that
  discards pre-rewrite responses, cursor repair for cached or retained records
  that have no paging window, and accumulation of session usage steps and V2
  `todowrite` records so exact totals survive paging. Only compaction/revert
  rewrites replace the window.
- `providers/use-transcript-read-errors.ts`
  Client-tagged, session-scoped record of cold transcript read failures. It
  wraps the transcript read before the prompt inbox, clears on a successful
  read, ignores silent background failures, and hides old-client errors after a
  reconnect so a failed read cannot be mistaken for an empty session.

MCP and worktree callback bridges use stable callbacks backed by the provider's
latest refs. Conversation submission similarly uses the latest send action
without restarting a submitted turn when message state changes.

These domain hooks are composed by `use-opencode-provider-composition.ts`, which
is the single orchestrator. Each hook receives the current client (and, when it
must call a later-defined provider callback, a latest-ref) and exposes its own
reset, so the provider's project/connection reset composes them instead of
inlining state.

`tests/vitest/architecture.test.ts` (run by `npm run test:vitest`) enforces a repo-wide readable-size ratchet: every source
file under `app/`, `components/`, `providers/`, `lib/`, and `widgets/` must stay at
or below **500 lines** (200-400 is the target; generated `lib/i18n/resources.ts` is
exempt), `providers/opencode-provider.tsx` must stay a thin wrapper at or below
**60 lines** because composition lives in
`providers/use-opencode-provider-composition.ts`, and the public context surface
cannot grow past 127 members. When a limit is genuinely outgrown, split the file
into the right layer and, if needed, lower the number in the same change.

### Services

- `providers/services/session-service.ts`
  Fetch sessions, messages, diffs, todos, commands, and perform session lifecycle actions, including V2 shell execution. Also lists the cross-project active-session snapshot through an unscoped client.
- `providers/services/capabilities-service.ts`
  Discover config, providers, provider auth methods, model capabilities, agents, skills, and references. Skill/reference discovery is V2-only and returns empty lists on V1.
  Catalog and speech-voice label sorting share `lib/compare-labels.ts`'s
  `Intl.Collator`, avoiding a native collator allocation per comparison on Hermes.
- `providers/services/project-service.ts`
  File search/read/status, VCS patch, and experimental worktree requests. Delegates contract branching to the project adapter.
- `providers/services/mcp-service.ts`
  MCP status, lifecycle, and OAuth requests. Delegates contract branching to the MCP adapter.
- `providers/services/terminal-service.ts`
  PTY lifecycle, connect-token, and WebSocket URL helpers.
- `providers/services/diagnostics-service.ts`
  Health and MCP diagnostics with per-endpoint availability.

### OpenCode Protocol Helpers

- `lib/opencode/client.ts`
  Builds the native OpenCode 2 client by default. Connection helpers under `lib/opencode/client/` own URL normalization, authentication, prefix handling, transport, probing, and pending interactions. Affirmative 1.x health/path discovery selects compatibility, including known `/api` compatibility routes. Unknown detection starts with v2; only missing endpoints or malformed protocol responses permit another contract attempt. Authentication and transport failures remain actionable.
- `lib/opencode/contracts/`
  The typed `ServerAdapter` boundary. `server-adapter.ts` normalizes terminal,
  MCP, diagnostics, project, capability, and interaction operations;
  `session-adapter.ts` normalizes session/catalog operations; `events.ts` owns
  event subscription translation. `client.compatibility` is read only here and
  in `compat/v1/`, and services call normalized methods.
- `lib/opencode/v2-client.ts`
  Constructs `@opencode/client` and exposes a typed subset of its native API, plus app actions for provider accounts, OAuth and inbox delivery. Adapters consume native sessions, cursor responses, forms and operations directly. V2 prompt admission maps resolved composer context into native `files`, `agents`, and `skills` mention arrays.
- `lib/opencode/composer.ts`
  Pure composer trigger/token parsing and final-draft mention resolution. It owns no React state and no wire access, keeping the same rules usable by the controller, tests, and protocol helpers.
- `lib/opencode/v2/`
  Native transport, auth/MCP helpers and presentation projections. No fabricated 1.x SDK response envelopes or translated 1.x events exist on this path.
- `lib/opencode/compat/v1/`
  The isolated 1.x compatibility implementation. Production `@opencode-ai/sdk` imports are allowed only here. It preserves legacy session, config, MCP, diagnostics and terminal behavior; its event dispatcher handles explicit compatibility extensions with no native equivalent.
- `lib/opencode/events.ts`
  Re-exports the adapter-owned subscription. Provider event handlers preserve reconnection reconciliation and polling fallback.
- `lib/opencode/format.ts` and `lib/opencode/types.ts`
  App-owned transcript, capability, session summary and diagnostics models. Protocol helpers and provider selectors derive these views; screens and presentation components never parse wire records. Persisted DTOs and storage keys remain stable.
- `lib/opencode/diff.ts`
  Normalizes session diffs across contracts. Native v2 serves a unified `patch`; v1 (and some v2 responses) serve whole-file `before`/`after` contents. The helper rebuilds a single-hunk patch from the contents so the viewer renders changed lines instead of a filename with an empty body, and keeps the server's reported totals.

Native v2 editing uses `vcs.status` and `file.write`. The provider compares the server text with the editor baseline before writing, verifies the saved text afterward, and refreshes file/VCS state. Drafts remain local on failure. The comparison cannot prevent a concurrent edit between the read and write because v2 has no conditional-write API.

MCP OAuth resolves each server's exposed `integrationID`, then uses native integration start/complete/status/cancel operations. The grouped provider interface carries code/automatic mode and form prompts; cleanup cancels attempts and rejects stale connection results. V1 supports only the V2 feature intersection: sharing, archive/restore, title summarization, general config writes, persistent MCP enablement, worktree reset, and LSP/formatter diagnostics are not supported.

Extensions are V2-only. The app does not use the runtime-only MCP add/remove endpoints for durable changes and does not call the shell-only `config.update`. Instead, it resolves the active project config and the user-global config directory from `config.get`, edits the raw JSONC with `jsonc-parser`, and replaces the file through a same-directory temp file and atomic rename. A backup is written first; the temporary and target bytes are verified; `config.get` is polled to confirm the server loaded the expected key; failures restore the backup. Project config reads append a per-request cache-busting parameter because a cached pre-create 404 can otherwise revalidate as a `304` against the renamed temp file's older mtime. Global files are read and moved with fixed, path-validated shell commands because V2 file reads are location-confined and there is no file-delete API. System and managed config, symlinks, Windows atomic replacement, ambiguous global roots, and missing shell support are read-only. Built-in plugins, embedded `/builtin/` skills, and upstream built-in commands are classified as system rows and omitted from the shared read-only list; they remain in the snapshot so name-collision checks still block conflicting user entries. Extension snapshots are server-derived and never persisted.

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
preparation refreshes credentials on the same owned machine, shares in-flight
access requests, and waits for native initialization when recovery needs it.
Foreground return recovers expired or missing credentials automatically; expiry
still blocks data-plane traffic. Same-machine renewal preserves the selected
project and migrates remembered state to the rotated credential scope. Saved
profile rows match Cloud Link machine identity and refresh after rotation. The `pair` route is
independent of onboarding completion. See [Cloud Link pilot](connect.md).

- `lib/connection-scope.ts`
  Canonical, deterministic, password-free connection identity (`getConnectionScope`). Every server-scoped storage key, favorite, and pending notification record derives from it; scheme/host are normalized while URL path and query casing are preserved.
- `lib/connection-profiles.ts`
  Saved connection metadata in AsyncStorage, per-profile passwords in SecureStore, whole-DTO validation, one shared read/modify/write transaction queue (manual, Cloud Link, preferences, removal and sanitation), and credential resolution for a connection that is not currently active.
- `lib/connection-headers.ts`
  Manual-connection custom request headers for gateways. Stores the active and per-profile maps in SecureStore, validates names/values, rejects app-owned/transport headers, and provides the canonical comparison used by connect keys and change detection. Resolution carries these headers with the connection password.
- `lib/connection-password.ts`
  Active connection password in SecureStore, including legacy plaintext migration.
- `lib/notification-pending.ts`
  Explicit non-secret pending-notification DTO, parsing, and composite keying.

### Chat UI

- `components/chat/chat-view.tsx`
  Main chat screen render, driven by `components/chat/use-chat-view-controller.ts` and `components/chat/use-chat-view-actions.ts`. It renders the transcript list, changes overlay, and pending interactions directly; there is no pass-through wrapper.
- `components/chat/content/`
  The chat area leaves: transcript list, changes overlay, pending interactions, and skeleton.
- `components/chat/chat-composer.tsx`
  Prompt input, attachments, and controls.
- `components/chat/chat-header.tsx`
  Session picker, New chat entry point, and conversation overlay mount point.
- `components/chat/new-chat-sheet.tsx`
  Server/project selection for creating a chat in a chosen workspace, mirroring the terminal creation sheet.
- `components/chat/chat-cards.tsx`
  Barrel over `components/chat/cards/` (message, diff, session-diff, permission, question-flow cards).
- `components/chat/chat-markdown.tsx`
  Memoized GFM renderer backed by `react-native-enriched-markdown`.
- `components/chat/chat-overlay.tsx`
  Full-screen conversation mode overlay.

### Settings UI

- `components/settings/sections/`
  Settings section components (diagnostics, connection, AI defaults, notifications, voice, language, appearance) plus `setting-rows.tsx`.
- `components/settings/provider-config-dialog.tsx`
  Provider auth modal.
- `components/settings/settings-utils.ts`
  Provider copy and option lists.

Cloud Link's four-step assistant is presentation in
`components/settings/connect-onboarding.tsx` and `connect-pairing.tsx`, sharing
`connect-subscription.tsx` and the existing scanner. It introduces no new routes,
stores or persistence. Native offers, purchase verification, secure saving,
finalization and automatic pairing still belong to the existing provider flow.
`lib/connect-install.ts` (resolved into `connectSetup.storeInstall`) gates the
Cloud Link Settings row to App Store and Google Play installs; the row sits
directly below AI & Providers and orders status, exposed services, subscription,
then machines. See [Cloud Link](connect.md) for entry, camera and deep-link
behavior.

### Platform Integrations

Android activity notifications are orchestrated by `use-activity-notifications`
inside the provider. The observer reads the connection-wide catalog through
the existing session service, receives global events before project filtering,
and polls independently of the Chat Library. `providers/services/activity-service`
aggregates scoped interaction, inbox, and newest-transcript reads; activity
selection folds descendants into their root tasks. No screen owns this state.

Local completion and needs-input notifications share
`providers/services/session-service`'s `readSessionSettlement`, so the
foreground flush (`use-prompt-lifecycle`) and the background monitor
(`lib/notifications`) clear and label a task identically. The same global-event
callback that drives activity reconciliation also raises a deduped needs-input
alert for tracked tasks while the app is not foregrounded. Notifications carry a
non-secret route payload; `hooks/use-notification-route.ts` in the root shell
forwards a tap into the existing `app/session/[id]` deep-link resolver so the
connection, project, and session are validated the same way as an external
link. When the SSE stream is healthy, the observer limits per-tick interaction
probes to directories with running or watched work and probes every directory
when the stream is down.

The local Expo module in `modules/opencode-activity` owns the Android notification
and a `dataSync` foreground service. Its Headless JS task only keeps React Native
timers alive; network reads and lifecycle decisions remain in the provider.
`index.js` registers that task before loading Expo Router. Native sources are
autolinked from `modules/` and survive a clean prebuild. iOS, web, Expo Go, and
E2E runs do not start this service.

Launcher quick actions remain foreground-only and use the existing active-session
selection. `providers/use-widget-state.ts` independently owns the three Android
widget snapshots. Its service aggregates the connection-wide session catalog,
newest messages for three recent root chats, and permission/question reads for
running, event-dirty or known-blocked projects while SSE is healthy. Initial
seeding, reconnection, foreground resume and polling fallback scan all projects.
Unprobed interaction data stays in the widget provider, including blockers
beyond its three displayed rows. It receives global SSE events before project filtering
and participates in the existing realtime reconciliation and 5s/10s polling;
cross-project running work and blockers keep the safety poll active. Notification
permission and Chat Library visibility do not gate widget reads.

- `lib/quick-actions.ts` and `hooks/use-quick-action-route.ts`: existing launcher
  bridge and validated session routing.
- `lib/session-link.ts`: shared credential-free session links.
- `providers/widget-content.ts`: bounded reply, blocker and real todo projections.
- `providers/widget-snapshot.ts` / storage: validated legacy-compatible snapshot,
  per-surface observation times, ordered writes before repaint, scope guards and
  preview redaction. No authentication credentials, tool output or raw request
  metadata are stored. Enabled previews do persist user-visible content.
- `lib/widgets.tsx` and `widgets/`: repaint the three registered widgets and render
  headlessly from storage; no headless network reads or mutations. Absolute update
  timestamps identify last-known state while suspended. The existing native
  `SessionWidget` identity is retained for Latest replies.
  The bridge awaits serialization and native dispatch for each placed widget
  separately, isolating lookup/repaint failures from other instances and the
  provider publish queue. The native draw API has no completion acknowledgement.

- `lib/notifications.ts`
  Local notifications, background monitoring task, and notification debug status.
- `lib/model-download.ts`
  Shared model-asset transfer used by TTS, wake-word and auto-model installs:
  foreground `DownloadTask` with the native 60 s Android stall timeout, one
  retry for transient failures, partial-file cleanup, and classified errors
  that the UI translates instead of showing native exception text.
- `lib/voice/speech-output.ts`
  Single speech-output facade. Prepares text, cancels the active run, owns the
  audio session, and delegates to the system or on-device engine. Keeps the
  completion, fallback, and stale-voice contracts shared by chat, auto-play,
  conversation readback, and the voice check.
- `lib/voice/speech-text.ts` and `lib/voice/speech-lexicon.ts`
  Pure markdown-to-speech normalization, pronunciation rules, path/identifier
  expansion, and paragraph-first chunking.
- `lib/voice/audio-session.ts`
  Shared ducking and audio-mode setup for system and on-device playback.
- `lib/voice/system-tts.ts`
  `expo-speech` adapter: voice discovery and quality metadata, automatic
  best-voice selection, chunk queue, stale-voice fallback, and completion
  watchdog.
- `lib/voice/speech-config.ts`
  Pure mapping from chat preferences to a system or local playback config; no
  native imports.
- `lib/voice/tts/`
  Optional on-device playback. `catalog.ts` pins downloadable Piper/Kokoro
  packs and licenses; `models.ts` installs, verifies, removes, and reports
  packs; `runtime.ts` owns the sherpa-onnx TTS singleton and idle release;
  `engine.ts` synthesizes WAV chunks and orchestrates prefetch; `player.ts`
  plays those chunks through `expo-audio` and cleans up cache files.
- `lib/voice/use-speech-input.ts`
  Speech recognition hook. Re-checks recognition availability at start, pins an
  explicit iOS audio session category, and retries once through network
  recognition when an on-device attempt fails.
- `lib/voice/wake-phrase.ts`
  Conversation-mode wake phrase normalization and matching. Interims and finals
  are accumulated with a short tail for phrases split across segments; only the
  text after the first phrase occurrence becomes the command.
- `lib/voice/wake-feedback.ts`
  Short haptic cue when the wake phrase arms a turn.
- `lib/voice/local-wake-word/`
  Optional on-device path: pretrained sherpa-onnx KWS, speaker-embedding,
  Silero VAD and Moonshine command models; PCM/resampling, model
  download/extraction, keyword token files, speaker-profile storage, and
  target-speaker turn gating. No model training is performed.
- `lib/voice/use-local-wake-word.ts`
  Microphone capture, KWS inference, and the verified-wake handoff.
- `lib/voice/use-local-command-capture.ts`
  Post-wake VAD turn segmentation, per-turn speaker verification, local command
  ASR, and command-window completion.
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

### Inbound Sharing

The Android `expo-sharing` receive plugin accepts single/multiple files (`*/*`).
`app/+native-intent.ts` routes shares to the preview with a receipt key so a
new intent refreshes an already-visible screen. The iOS extension remains
[deferred](ios-share-parity.md). A version-checked prebuild patch in
`scripts/prepare-android-sharing.cjs` fixes Expo Sharing 57.0.22 stream handling,
accompanying text, unique cache copies and bounded reads; review it on upgrade.
Android autolinking builds only `expo-sharing` from source so the patched Kotlin
is compiled instead of silently using Expo's bundled precompiled AAR. FOSS
preparation preserves that setting.
The prebuild helper also keeps `share_into_scheme` from optimized Android
resource shrinking: Expo loads this string dynamically to create the share link.
The redirect matches the exact share host directly, because React Native's
`URL.hostname` does not parse custom app schemes. Other deep links pass through.

`lib/share/parse.ts` normalizes Java `file:/` URIs without decoding paths, treats
text/HTML streams as attachments, applies the ten-item and per-file 10 MB limits,
and preserves skipped-item warnings even if nothing is usable.
`providers/use-share-state.ts` owns in-memory receipts, the 10-minute TTL,
hydration-dependent default destination, connection-scoped chooser data,
confirmation, guarded session creation/opening and one-shot consumption.
`app/share.tsx` renders preview/chooser/error state and navigates only after the
provider confirms the destination. The composer consumes only a confirmed share
whose connection, project and session match; it appends text and URL without
losing the local draft and deduplicates attachments. Nothing auto-sends. Discard,
expiry and connection changes cancel stale operations; failures retain the share.
Add and Discard dismiss back to the existing tabs navigator, preserving the
mounted composer's draft and attachments instead of replacing it with new tabs.

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

UI text is grouped into feature namespaces (`common`, `chat`, `project`,
`terminal`, `settings`, `notifications`). Components translate with
`useTranslation()` and explicit namespace prefixes. The root layout imports
`lib/i18n` so translations are initialized before first render, and
`OpencodeProvider` applies the persisted language preference after hydration.

Domain labels are translated at render where the data carries a stable
by-kind value: tool names and diff turn numbers are localized in the chat cards,
and connection setup errors accept an injected translator while retaining an
English fallback for non-React callers. Remaining wire/server messages and
detail labels embedded in memoized transcript records stay English until they
are reshaped to carry keys. Notification copy is already translated inside
`lib/notifications.ts`, so the provider passes only the session title.

## Runtime Boot Sequence

The normal startup flow is:

1. Root layout mounts providers and keeps the native splash up.
2. `useOpencodePersistence()` hydrates settings, chat preferences, active project, the connection-scoped opened projects, the last-session map, and the onboarding completion marker from AsyncStorage.
3. The routing gate resolves: existing configured installs show `(tabs)`; a fresh install shows the onboarding assistant. A fresh install does not auto-connect.
4. After hydration, once onboarding is completed, `OpencodeProvider` calls `connect()`.
5. `connect()` loads the project catalog using a catalog-scoped client with no directory, seeds the connection's opened-project list from the server's current project when it was never initialized, and keeps the opened and active projects in sync. Runtime catalog refreshes pass the runtime's directory to `location.get`, so a worktree keeps its own resolved checkout instead of falling back to the server's root project.
6. Connection state becomes `connected` or `error`.
7. If a project exists, the provider fetches sessions and chat capabilities.
8. A follow-up effect calls `ensureActiveSession()` for the active project.
9. `ensureActiveSession()` honors a transient deep-link target (set by `openDeepLinkSession`), then reopens the remembered session, falls back to the newest returned session, or creates a new one. A deep-link target that does not match any session never triggers session creation. The selected session ID is committed before transcript, diff, todo, interaction, capability, feature, or diagnostic reads; those reads continue in the background. An explicit `openSession()` writes the selection ref immediately and invalidates any in-flight bootstrap, so a render-delayed startup pass cannot replace the chat the user just chose.
10. The Chat tab renders the selected session's header and a transcript skeleton while the first page lands. It then fills in transcript, diffs, todos, pending interactions, and controls as the background reads settle.

In-app navigation and deep links are separate paths. Library rows, favorites, and approval shortcuts call the workspace registry's `navigate(target)`, which prepares the owning runtime and calls the local `openSession()`; it never reads the server session list. External entry points (notification taps, home widgets, quick actions, and OS `opencodemobile://session/...` links) route through `app/session/[id].tsx`, which calls `openDeepLinkSession()` to resolve and validate the connection, project, and session before switching. `tests/vitest/architecture.test.ts` keeps `openDeepLinkSession` out of in-app components.

When the app is launched from (or navigated to) a session deep link, the dedicated resolver route `app/session/[id].tsx` parses `sessionId` + `project`, calls `openDeepLinkSession()`, and replaces onto the Chat tab where the session is already current.

This boot chain is important because the Chat screen itself is not responsible for initial data ownership. It only triggers `ensureActiveSession()` when the provider has enough context.

## Client Topology

The provider creates two client instances:

- `client`
  Bound to `settings` plus `activeProjectPath`. Used for session-scoped calls.
- `catalogClient`
  Bound to `settings` with an empty directory. Used for project discovery, diagnostics, and the global event stream.

This split is one of the key architectural details. Project discovery is intentionally decoupled from a selected project directory.

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

- project catalog
- sessions and statuses
- messages per session
- diffs per session plus project VCS diffs (`uncommitted`/`branch`), selected by Files Changed scope
- todos per session
- pending permissions and questions by session, populated by events and refreshed from the server
- providers, models, and agents
- commands, project file status/search/read bytes, VCS information, and diagnostics
- worktrees, MCP statuses, PTYs, terminal connection state, and terminal output
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
- `navigate`
- `openDeepLinkSession` (external links only)
- `sendPrompt`
- `abortSession`
- `replyToPermission`
- `replyToQuestion` and `rejectQuestion`
- `deleteSession`, `renameSession`, `forkSession`, and `revertSession`
- `executeCommand`
- project search/open/save/download and diagnostics refresh actions
- project patch save, worktree, MCP, and terminal actions
- `setProviderAuth`
- `toggleConversationMode`
- `completeOnboarding`, `startOnboardingReview`, and `stopOnboardingReview` (first-run setup completion and Settings re-entry)

## Real-Time Update Architecture

The app uses two update strategies in parallel:

### Primary Strategy: SSE Subscription

When connected and a project is active, the provider opens `catalogClient.global.event()`. Global event envelopes are filtered by `directory === activeProjectPath` before their payload is handled. If the stream ends or fails, the provider reconnects indefinitely with jittered exponential backoff from 1 second to 15 seconds. A first-byte timeout bounds a stalled handshake, and the backoff only resets after the stream has been stable for five seconds.

A socket can also die without an error. A liveness watchdog re-establishes
the subscription when a foreground stream has received no envelope or keepalive
activity for a staleness window (60 seconds idle, 45 seconds while work or a
blocking interaction is active; shortened in E2E builds), and foreground return
bypasses the remaining backoff or cycles a stream that was backgrounded long
enough. A reachability transition from offline to online also cancels the
backoff and restarts immediately. Reconnects keep a first-envelope authoritative
reconcile (sessions, interactions, and native surfaces) and tail-merge the
transcript; if a poll is already in flight, the reconnect pass is queued behind
it instead of being coalesced away. Invalid-credential and entitlement failures
stop the retry loop and are surfaced through `ConnectionState.kind`
(`auth`/`entitlement`), while Cloud Link reuses its prepared credential recovery.

Recognized events update local state or schedule refreshes for:

- session creation/update/deletion
- session status changes
- session idle completion
- message updates
- message part updates/removals/deltas
- session diff updates
- todo updates
- permission and question requests/replies
- capability/config, project-directory, VCS, worktree, MCP, and terminal changes
- MCP authentication failures (`mcp.browser.open.failed`), surfaced as an in-chat approval alert

### Safety Strategy: Polling Fallback

The provider keeps a safety polling loop when any of the following is true:

- SSE is not connected
- any session is non-idle
- a prompt is currently being submitted
- conversation mode is active

While SSE is connected the loop runs every 10 seconds (15 seconds on a
constrained link); without a stream it is the primary transport and runs every 5
seconds (8 seconds constrained). Offline and background states pause the loop,
and repeated failed passes double the interval up to 30 seconds. A submitted
prompt also schedules a one-off transcript refresh 5 seconds after send, so a
completion whose event is missed (for example from another project) still lands
even with the slower connected cadence. On OpenCode 2 the safety poll reads only
the active-session status set; full cursor-paged session lists are reserved for
connect, reconnect, foreground return, library open, and session-list events.
Polling refreshes current/conversation session content and pending interactions
as needed. The `/permission` and `/question` list APIs recover requests missed
by SSE.

Event-driven refreshes are coalesced per domain. Session-list, capability,
server-feature, and project-catalog bursts collapse into one trailing read
instead of starting overlapping requests. A deleted session is removed from the
local list immediately, before the coalesced reconciliation lands.

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
- fork from or revert to a user message; a staged revert pre-fills the composer, and its notice can cancel the revert
- discard waiting steer/queue prompts, restoring their text when the composer is empty
- toggle auto-approve
- select agent/model/reasoning
- start/stop microphone dictation for the draft box
- start/stop conversation mode
- play assistant replies via TTS
- abort running sessions
- create and switch sessions

### Project Screen

Responsibilities:

- retain the Projects tab and route, with Files as the main surface
- browse folders and navigate breadcrumbs inside the selected directory
- search across the active project, preview text, and retain the browsed folder on return
- preserve conflict-checked text editing and confirm before discarding unsaved edits
- show supported changed-file information and the current VCS branch
- refresh the current folder or search, file status, and project catalog together
- use the shared project picker for project/worktree selection and worktree management

### Settings Screen

Responsibilities:

- configure the active connection (server URL, username, password, custom gateway headers) from its row and reconnect manually; editing applies only after Reconnect
- add, edit, and delete named connection profiles, and switch between them from the connection list; switching persists the outgoing profile's model selection, restores the target profile's selection, and reconnects with that profile's credentials
- inspect server health, realtime status, and MCP counts
- add local or remote MCP servers; connect, disconnect, enable, disable, and complete remote OAuth
- manage project or user-global MCPs, plugins, skills, and slash commands in Extensions; show the target config path, safety state, and last backup
- configure providers
- remove configured provider credentials
- choose model enablement defaults
- show the Cloud Link section directly below AI & Providers, and only for store installs, with status → exposed services → subscription → machines ordering
- inspect and enable notification setup
- manage voice and response-style preferences
- adjust the chat transcript text size, bubble/flat layout, and slim interface density
- choose the app interface language
- group chat text size, flat conversation and V2 Steer/Append delivery under Advanced → Editor; group slim interface, language and Reset onboarding under Advanced → General; expose the app update preference under Advanced → Update checks
- launch Reset onboarding at the presentation screen, with permissions, connection, providers, project and general preferences seeded from current state without wiping configuration

### Terminal Screen

Responsibilities:

- list project PTYs
- create, open/reconnect, and terminate PTYs
- request a short-lived connect ticket and stream PTY data over a project-scoped WebSocket
- provide xterm terminal emulation with immediate input and a system-keyboard accessory

The provider delivers raw VT output in ordered acknowledged batches to xterm. It owns reconnect cursors, resize, and per-PTY transport lifetime; xterm owns the display and 10,000-line scrollback. Retained PTYs read the live client and credentials through a context accessor, so a same-machine Cloud Link credential rotation reconnects the transport with fresh credentials instead of disposing the renderer and cursor. Unexpected disconnects retry with jittered 1/2/4/8/15-second delays.

## Conversation Mode Architecture

Conversation mode is a provider-level state machine with phases:

- `off`
- `armed` (recognizer open, waiting for the configured wake phrase)
- `listening` (phrase matched, command being captured)
- `submitting`
- `waiting`
- `speaking`

Supporting behaviors include:

- continuous speech recognition gated by a configurable wake phrase
  (`lib/voice/wake-phrase.ts`), default `hey code`
- phrase matching on interims and finals, with a short tail so a phrase split
  across segments still matches
- final-result settling delay before submission
- a command window timeout that re-arms when only the phrase is heard
- automatic assistant reply playback
- optional automatic return to armed after playback
- keep-awake activation
- blocking if pending permissions or questions exist
- cancellation and cleanup across timers, speech input, TTS, and working sound

The phrase gate is the only turn trigger: text before the phrase is discarded,
the phrase is stripped from the prompt, and no turn is submitted while armed.
Recognition itself still runs while armed; this is not a separate wake-word
engine.

### Optional on-device wake word

`voiceWakeMode: 'local'` replaces the text gate with an opt-in on-device path:

- `lib/voice/local-wake-word/` downloads and loads pretrained sherpa-onnx
  models: KWS (English, open vocabulary), speaker embedding, Silero VAD, and a
  selectable command recognizer (Moonshine tiny English by default; Whisper tiny
  multilingual is optional). The base wake pack and the command model are
  installed/replaced independently.
- `lib/voice/use-local-wake-word.ts` captures 16 kHz PCM, feeds the KWS model,
  keeps a short rolling buffer, and verifies the enrolled speaker when enabled.
- `lib/voice/use-local-command-capture.ts` runs after a verified wake. Silero
  VAD segments speech turns; each finalized turn is embedded and compared to the
  enrolled profile; only matched turns go to the selected local ASR. Accepted
  text accumulates and is submitted after a short silence (or a bounded
  no-speech/max window). Non-matching turns are discarded before ASR.
- The OS recognizer is not used in the local command path. The agent server still
  receives text only.
- Models are installed by explicit user action from
  `components/settings/use-voice-setup.ts`; they are stored under the app's
  document directory. No model training is involved.
- If models or the native runtime are unavailable, conversation mode falls back
  to the phrase gate and surfaces feedback.
- Overlapping speakers are not separated; target-speaker gating works on
  non-overlapping turns. Local TTS is out of scope.

`providers/conversation/use-local-wake-controller.ts` owns the detector-to-command
handoff, speaker rejection/re-arming, and the local command submission path. The
main conversation state machine continues to own phases, submission, playback,
and cleanup.

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
  `behavior="height"`. All bottom-sheet overlays dismiss on a downward header
  drag through `components/ui/use-swipe-dismiss.ts`; the `Modal` sheets wrap
  their content in `GestureHandlerRootView` so the gesture is recognized inside
  the native `Modal` window.
- The app uses custom theme tokens from `constants/theme.ts` and maps them into React Native Paper in `constants/paper-theme.ts`. `constants/appearance.ts` defines the app-wide theme mode (`system`, `light`, `dark`) and color themes (`green` default plus blue, red, purple, pink, and gray). `providers/appearance-context.tsx` publishes the effective scheme, color theme, and memoized palette; `hooks/use-color-scheme.ts` and `hooks/use-palette.ts` are the only read paths, and only `AppearanceHost` subscribes to the system scheme. Each theme supplies a full light/dark palette: backgrounds, surfaces, cards, borders, secondary text, tab chrome, chat bubbles, accents, and code surfaces. Text and semantic colors stay shared. The appearance preferences persist globally with `chatPreferences` but are excluded from `serverPreferences` so connections cannot overwrite them.
- Markdown rendering is intentionally narrow and custom, not library-based.
- Diff rendering is custom and optimized for readable in-app inspection, not full git-style fidelity.
- The chat area surfaces server-owned todos in a collapsed overlay with read-only status icons. It does not mutate todo state.
- Working sound is started by the provider while a send or any session is busy, when enabled, except during listening and speaking phases.

## Architectural Hotspots

The highest-coupling areas are:

### `providers/use-opencode-provider-composition.ts`

This is the main behavioral hotspot. Changes here can affect nearly every screen.
The wrapper (`opencode-provider.tsx`) and the tree (`opencode-provider-tree.tsx`)
stay mechanical so orchestration pressure is visible in one file.

### Prompt lifecycle

`sendPrompt()`, notification tracking, session refresh, summarization, attachment capability checks, and attachment encoding are tightly coupled.

### Conversation mode

It spans provider state, timers, speech recognition, TTS, keep-awake, and chat state.

### Capability refresh

Provider/model/agent choices depend on server config, configured providers, current preferences, and stored selections.

## Reimplementation Guidance

If the system is rebuilt, the safest parity-preserving architecture would keep these concepts intact:

- one central orchestration layer
- a separate project-discovery client from a project-scoped session client
- combined SSE + polling safety net
- persisted connection/preferences/project/session identity state
- transcript model derived from raw message parts rather than storing rendered text only
- explicit conversation mode state machine
- event-driven handling for session-scoped permission blocking flows

Those are implementation-defining patterns, not incidental details.


## Session library recovery (#64)

Session idle events only refresh domain state.

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

## Project file browser

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

Binary project files open in the same focused preview surface. `readProjectFile`
uses the V2 file bytes for inline raster-image, audio and video previews; known
archives, installers and documents skip the read and render a download card
instead. The preview keeps at most 25 MB of media bytes and falls back to download
for larger files. Downloads stream from the authenticated V2 filesystem route on
native and become a browser download on web; text files use the same action.
OpenCode 1 returns empty binary content, so its binary files show an explicit
unavailable state while text editing and text downloads continue to work.
`projectFile` groups the selected file and its open/save/close/download actions so
the public context surface stays bounded.

The shared Project/Chat picker contains worktree inventory for the owning
project, resolved from the scoped project API rather than path prefixes. Directory
selection uses the workspace registry and changes Chat and Project focus;
existing terminals retain their own workspace. Creation stays in the picker; reset/remove live in row
menus, preserve confirmations and reject the active directory and primary checkout.
OpenCode 2 hides reset/startup commands and maps directory-only inventory to names.
The browser groups state and actions under one context member, keeping the public
context below the 135-member ceiling. Screens and components call provider actions;
services and protocol modules own requests and response normalization.

## App update integration

The existing provider owns `useAppUpdates` and its `useUpdates()` domain hook.
The tab shell renders the nonmodal banner above its default tab bar without
covering screen controls on Chat, Project, Settings and Terminal; the root
shell owns route eligibility, the transparent handoff gate and failure snackbar.
Available Play candidates open native consent
directly at a safe moment. Local UI registers busy presence through
`useUpdateBlocker`, retaining its own contents. `lib/app-updates.ts` wraps the local
Expo module and iOS lookup. See [app updates](app-updates.md) for install consent,
safety gates and FOSS exclusion.

## Multi-server V2 ownership

`use-workspace-connections.ts` owns explicit connect/disconnect, restoration, and composite connection/project identity. A runtime stays mounted when another chat or tab is selected. Its clients, generations, transcript windows, prompt inbox, approvals, file browser and PTY connections remain separate. `shared-event-stream.ts` fans one server subscription out to retained projects; events are still filtered by directory and the existing polling/reconciliation paths remain active.

Hydration, compatibility settings writes, device sharing, Cloud Link setup/billing, updates, language, audio and native surfaces have one app-wide owner. Favorites, opened projects and remembered sessions keep their existing connection-scoped persistence. Activity observation has one owner per server, with one app-wide Android notification publisher combining counts and releasing only the disconnected server. Native shortcuts carry each row's connection scope; widget publication remains app-wide.

The chat library combines the unscoped server catalogs with live project state. It keeps current/running/recency order, uses composite keys and labels each row with its server. Project selection changes chat/project focus. Terminal selection and Settings inspection are independent. Paper portals explicitly restore their caller's workspace scope; otherwise their children would inherit the app host's current chat server.

Terminal renderers remain mounted when hidden. Hidden instances cannot accept input or layout resize; disconnect detaches transports without deleting remote PTYs. Composer and editor drafts and transcript reading positions live in an in-memory presentation map, keyed by owning server/project/session or file. They survive navigation, not process termination. No external store or dependency was introduced.
