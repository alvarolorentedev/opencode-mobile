# Architecture

## High-Level Shape

The app uses a simple structural pattern:

- Expo Router provides navigation and screen composition.
- `OpencodeProvider` owns nearly all domain state and orchestration.
- Screens are thin and read/write provider state through `useOpencode()`.
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

## Navigation Architecture

The app has one tab group in `app/(tabs)/_layout.tsx`:

- `index` -> Chat
- `workspace` -> Workspace
- `settings` -> Settings

Navigation complexity is deliberately low. There are no nested feature stacks, no per-screen providers, and no deep in-app route hierarchy.

This matters because state continuity is expected across tabs. Switching tabs does not reset active session context.

## Core Architectural Principle

The dominant design decision is central orchestration through `providers/opencode-provider.tsx`.

This file is the application's effective domain layer. It owns:

- connection settings and connection state
- workspace catalog and active project selection
- session lists and session status tracking
- current session selection and data refresh
- transcript, diff, and todo caches
- pending permission and question queues
- provider/model/agent capability discovery
- chat preference management
- prompt send / abort lifecycle
- conversation mode state machine
- notification completion tracking
- SSE subscription and polling fallback
- persistence hydration and write-back

If this app were reimplemented, this provider would be the main source of truth for required behavior.

## Module Map

### App Shell

- `app/_layout.tsx`
  Root providers, theming, side-effect bootstrap.
- `app/(tabs)/_layout.tsx`
  Bottom tabs only.

### Screens

- `app/(tabs)/index.tsx`
  Chat landing logic. Ensures a session exists and renders `ChatView` once available.
- `app/(tabs)/workspace.tsx`
  Project picker, session list, create/open/archive flows.
- `app/(tabs)/settings.tsx`
  Settings screen controller for connection, providers, notifications, and voice.

### Provider Layer

- `providers/opencode-provider.tsx`
  Main orchestrator and context source.
- `providers/opencode-provider-types.ts`
  Shared public types and constants.
- `providers/opencode-provider-utils.ts`
  Preference defaults, config helpers, model/provider selection logic, permission config helpers.
- `providers/opencode-provider-selectors.ts`
  Derived selectors extracted from the provider body.
- `providers/use-opencode-persistence.ts`
  AsyncStorage hydration and persistence.
- `providers/use-conversation-keep-awake.ts`
  Keeps device awake during conversation mode.
- `providers/use-conversation-screen-dim.ts`
  Dims screen during conversation mode.

### Services

- `providers/services/session-service.ts`
  Fetch workspace catalog, sessions, messages, diffs, and todos.
- `providers/services/capabilities-service.ts`
  Discover config, providers, provider auth methods, models, and agents.

### OpenCode Protocol Helpers

- `lib/opencode/client.ts`
  Builds SDK client, normalizes server URL, adds optional basic auth, and implements manual endpoints for permissions/questions/session archive patching.
- `lib/opencode/format.ts`
  Converts raw message records into transcript entries and helper labels.
- `lib/opencode/transcript.ts`
  Transcript activity helpers and display filtering.
- `lib/opencode/types.ts`
  Lightweight compile-time aliases, intentionally permissive.

### Chat UI

- `components/chat/chat-view.tsx`
  Main chat screen controller.
- `components/chat/chat-content.tsx`
  Transcript, pending interactions, and diff tab rendering.
- `components/chat/chat-composer.tsx`
  Prompt input, attachments, controls, and todo summary surface.
- `components/chat/chat-header.tsx`
  Session picker and conversation overlay mount point.
- `components/chat/chat-cards.tsx`
  Message, diff, permission, and question cards.
- `components/chat/chat-markdown.tsx`
  Small custom markdown renderer.
- `components/chat/chat-overlay.tsx`
  Full-screen conversation mode overlay.

### Settings UI

- `components/settings/settings-sections.tsx`
  Settings sections as presentational components.
- `components/settings/provider-config-dialog.tsx`
  Provider auth modal.
- `components/settings/settings-utils.ts`
  Provider copy and option lists.

### Platform Integrations

- `lib/notifications.ts`
  Local notifications, background monitoring task, and notification debug status.
- `lib/voice/speech-output.ts`
  Text-to-speech and audio ducking.
- `lib/voice/use-speech-input.ts`
  Speech recognition hook.
- `lib/voice/working-sound.ts`
  Generated looping working sound.

## Runtime Boot Sequence

The normal startup flow is:

1. Root layout mounts providers.
2. `useOpencodePersistence()` hydrates settings, chat preferences, active project, and last session map from AsyncStorage.
3. After hydration, `OpencodeProvider` calls `connect()`.
4. `connect()` loads workspace catalog using a catalog-scoped client with no directory.
5. Connection state becomes `connected` or `error`.
6. If a project exists, the provider fetches sessions and chat capabilities.
7. A follow-up effect calls `ensureActiveSession()` for the active project.
8. `ensureActiveSession()` reopens the remembered session, falls back to the latest session, or creates a new one.
9. The Chat tab can then render transcript, diffs, todos, pending interactions, and controls.

This boot chain is important because the Chat screen itself is not responsible for initial data ownership. It only triggers `ensureActiveSession()` when the provider has enough context.

## Client Topology

The provider creates two client instances:

- `client`
  Bound to `settings` plus `activeProjectPath`. Used for session-scoped calls.
- `catalogClient`
  Bound to `settings` with an empty directory. Used for workspace-level discovery and global pending request fallback.

The same runtime SDK client is also reused as `v2Client` for permission/question endpoints.

This split is one of the key architectural details. Workspace discovery is intentionally decoupled from a selected project directory.

## Data Flow Model

### Server -> Provider

The provider fetches and caches:

- workspace catalog
- sessions and statuses
- messages per session
- diffs per session
- todos per session
- pending permissions/questions by session
- providers, models, and agents

### Provider -> Derived State

Selectors transform provider state into:

- current transcript
- session preview text
- visible configured providers
- current pending requests scoped to active or sending session
- conversation status label

### Provider -> UI

Screens and components consume one context and render local presentation states.

### UI -> Provider

User interactions are converted to provider actions such as:

- `connect`
- `selectProject`
- `createSession`
- `openSession`
- `sendPrompt`
- `abortSession`
- `replyToPermission`
- `replyToQuestion`
- `setProviderAuth`
- `toggleConversationMode`

## Real-Time Update Architecture

The app uses two update strategies in parallel:

### Primary Strategy: SSE Subscription

When connected and a project is active, the provider subscribes to `client.event.subscribe()`.

Recognized events update local state or schedule refreshes for:

- session creation/update/deletion
- session status changes
- session idle completion
- message updates
- message part updates/removals
- session diff updates
- todo updates
- permission updates/replies

### Safety Strategy: Polling Fallback

The provider keeps a 5-second polling loop when any of the following is true:

- SSE is not connected
- any session is non-idle
- a prompt is currently being submitted
- conversation mode is active

Polling refreshes sessions, current session content, conversation session content, and pending requests as needed.

This dual model is critical. The implementation does not trust SSE alone.

## Screen Responsibilities

### Chat Screen

`ChatView` is the main operator surface.

Responsibilities:

- render session transcript
- render pending permission/question interactions inline
- render diff tab
- send prompts and attachments
- toggle auto-approve
- select agent/model/reasoning
- start/stop microphone dictation for the draft box
- start/stop conversation mode
- play assistant replies via TTS
- abort running sessions
- create and switch sessions

### Workspace Screen

Responsibilities:

- show connection summary for workspace context
- refresh workspace catalog and sessions
- select active project
- create/open sessions
- archive and unarchive sessions
- show active vs archived session lists

### Settings Screen

Responsibilities:

- edit connection settings
- reconnect manually
- configure providers
- choose model enablement defaults
- inspect and enable notification setup
- manage voice and response-style preferences

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
- brightness dimming
- blocking if pending permissions/questions exist
- cancellation and cleanup across timers, speech input, TTS, and working sound

This is one of the densest parts of the architecture and would need careful parity in any rewrite.

## Presentation Architecture Notes

- The app uses custom theme tokens from `constants/theme.ts` and maps them into React Native Paper in `constants/paper-theme.ts`.
- Markdown rendering is intentionally narrow and custom, not library-based.
- Diff rendering is custom and optimized for readable in-app inspection, not full git-style fidelity.
- The chat composer also surfaces server-provided todos, but the checkbox interaction is local UI state only and does not write back to the server.

## Architectural Hotspots

The highest-coupling areas are:

### `providers/opencode-provider.tsx`

This is the main behavioral hotspot. Changes here can affect nearly every screen.

### Prompt lifecycle

`sendPrompt()`, notification tracking, session refresh, summarization, and pending request refresh are tightly coupled.

### Conversation mode

It spans provider state, timers, speech recognition, TTS, keep-awake, brightness, and chat state.

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
- inline handling for permission/question blocking flows

Those are implementation-defining patterns, not incidental details.
