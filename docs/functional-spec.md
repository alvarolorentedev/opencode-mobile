# Functional Specification

## Product Purpose

The mobile app is a client for interacting with an OpenCode server from a phone or tablet. It is optimized for:

- selecting a workspace hosted by the server
- opening or creating chat sessions tied to that workspace
- sending prompts and files to OpenCode
- tracking transcript, file changes, todos, and blocking requests
- configuring providers, models, and voice behavior
- optionally using a hands-free conversation mode

This document describes current user-visible behavior that should be preserved for parity.

## Primary User Journeys

### 1. Connect to an OpenCode Server

The user can enter:

- server URL
- username
- password

Behavior:

- server URL is normalized to include a protocol if omitted
- password is optional; if present, basic auth is sent
- reconnecting re-runs workspace discovery, session fetch, and capability discovery
- connection status can be `idle`, `connecting`, `connected`, or `error`
- connection state includes a human-readable message shown in the UI

### 2. Pick a Workspace

The Workspace tab lists projects returned by the server.

Behavior:

- projects are deduplicated by worktree path
- projects are sorted by most recently initialized/created first
- the active project can be selected from the list
- selecting a project clears the current session selection
- the provider later rehydrates or creates the appropriate session for that project
- the current server project may be labeled `Current`; the selected app project may be labeled `Active`

### 3. Open or Create a Chat Session

The app maintains one active session at a time for the active project.

Bootstrapping behavior:

- if a remembered session exists for the project and still exists on the server, it is reopened
- otherwise the latest available session is used
- if no session exists, one is created automatically

Manual behavior:

- user can create a new session from the Workspace tab
- user can create a new session from the Chat header
- user can switch sessions from the Chat header session sheet

### 4. Send a Prompt

The user can send:

- text only
- files only
- text plus files

Behavior:

- blank text with no attachments is rejected locally
- prompt submission is blocked if another submission is already active
- if no active session exists, the app creates or resolves one first
- local/mobile file URIs are read and converted to data URLs before sending because the server cannot reach device-local paths
- remote `http` and `https` attachment URLs are passed through unchanged
- request body includes selected agent, selected model, and generated system prompt derived from preferences

After submission:

- active session is refreshed
- transcript, diff, todos, and pending requests are refreshed
- untitled sessions are summarized using the selected model when possible
- a pending local-notification tracker is created for the session

### 5. Watch the Session Progress

The Chat screen shows:

- transcript messages
- inline running status text while OpenCode is active
- pending permissions/questions if OpenCode is blocked waiting for the user
- a changes tab with current file diffs
- todos when provided by the server

Behavior details:

- only user messages and assistant messages with text or errors appear in the main transcript
- reasoning and tool activity are summarized and attached to assistant messages as metadata chips
- a status line like `OpenCode is ...` is shown while running and not blocked on user input
- if the assistant is blocked on permissions/questions, a waiting card is shown and interactions render inline

### 6. Resolve Blocking Requests

The app supports two blocking request types from the server.

#### Permission Requests

Each permission request shows:

- a derived title from the permission key
- optional path or pattern list
- action buttons: `Allow once`, `Always allow`, `Deny`

After reply:

- request list is refreshed
- current session messages are refreshed

#### Question Requests

Each question request can include:

- one or more questions
- single-select or multi-select answers
- optional custom free-text answer

Behavior:

- submit is disabled until each question has either a selected option or a custom answer when custom answers are allowed
- question rejection is supported
- after reply or rejection, pending requests and current messages are refreshed

### 7. Inspect File Changes

The `Files Changed` tab shows the current session diff.

Behavior:

- top card shows session subtitle and current status
- if the server returns structured diff objects, they are rendered with additions/deletions and an expandable line diff preview
- if only transcript patch/file details exist, those are used as a fallback display source
- if nothing has changed, the user sees `No file changes yet.`

### 8. Manage Sessions in the Workspace Tab

The Workspace tab provides lifecycle operations:

- refresh workspace catalog and sessions
- open a session
- create a new session
- archive an active session
- unarchive an archived session
- toggle visibility of archived sessions

Session list behavior:

- sessions are split into active and archived groups by `session.time.archived`
- each session row shows title, preview/subtitle, relative updated time, and status
- active session rows are visually emphasized

## Chat Screen Detailed Behavior

## Empty State

When a session has no display transcript yet, the user sees:

- `Start a new task`
- descriptive copy about specific prompts
- tappable starter prompts that immediately send predefined text

## Transcript Behavior

- transcript is paginated from the bottom using a fixed page size
- `Load earlier messages` reveals older transcript entries
- automatic scroll-to-end happens for new content unless the view is currently paginating older items
- long-pressing a message copies its text/error content
- assistant messages can be played with TTS if they contain readable text

## Composer Behavior

The composer includes:

- agent picker
- model picker
- reasoning picker
- auto-approve toggle
- optional conversation mode banner
- optional todo summary card
- attachment chips
- text input
- primary and secondary action buttons

Primary action rules:

- if the session is running and there is no draft content, the main action becomes `stop`
- otherwise the main action is either `attach` or `send`

Secondary action rules:

- with content present, the secondary button attaches files
- without content, the secondary button toggles microphone dictation

## Abort Behavior

When a session is running and there is no draft content, the main composer action aborts the active session.

Abort behavior:

- clears pending completion notification tracking for the session
- calls the server abort endpoint
- refreshes sessions, messages, diff, todos, and pending requests

## Auto-Approve Behavior

The auto-approve toggle updates the server config, not just local UI state.

Enabled means these permissions are set to `allow`:

- `edit`
- `bash`
- `webfetch`
- `doom_loop`
- `external_directory`

Disabled sets them back to `ask`.

## Provider / Model / Reasoning Selection

The chat composer exposes runtime choices directly.

Behavior:

- only configured providers contribute models to the model picker
- model choices are also filtered by the enabled-model list from Settings
- selecting a model updates both `providerId` and `modelId`
- reasoning level affects only the generated system prompt, not local control flow

## Session Title Summarization

If a session has no title after a prompt is sent, the app asks the server to summarize the session title using the selected model.

If summarization fails, the session simply remains untitled.

## Settings Screen Detailed Behavior

### Connection Section

Allows editing server URL, username, and password.

Behavior:

- values are persisted locally
- reconnect button explicitly re-runs connection flow
- status card shows current state and last checked timestamp

### AI Defaults Section

Purpose:

- show configured providers
- add additional providers
- control which configured models appear in chat

Behavior:

- unconfigured providers appear in an `Add provider` selector
- configured providers display as chips
- models are grouped by provider in accordions
- each model can be toggled on/off from the enabled list
- if all stored enabled models disappear, all currently available configured models become enabled by default

### Provider Configuration Behavior

The app supports two auth styles:

- OAuth
- API/manual auth

Behavior:

- provider auth metadata comes from the server
- if the server returns no auth methods for a non-known-OAuth provider, the app falls back to a generic API-key flow
- if OAuth is selected, the app requests an authorization URL, opens the browser, then reconnects
- if API auth is selected, auth values are normalized and sent to `client.auth.set`
- after successful auth, the provider is enabled in server config and capabilities are refreshed

### Notifications Section

Purpose:

- help the user enable local notifications for task completion
- show a debug-style summary of notification readiness

Behavior:

- on supported platforms, permission status is read from the system
- Android users can be deep-linked to notification settings and battery-related settings
- `Enable notifications` requests permission and refreshes status
- `Refresh status` re-queries permission and background-task registration state

### Voice Section

Purpose:

- configure both speech input and speech output behavior
- configure response style controls that are implemented as system prompt hints

Behavior exposed today:

- prefer on-device voice recognition
- auto-play assistant replies
- working sound enable/disable
- resume listening after spoken reply in conversation mode
- speech locale override
- response scope (`brief`, `balanced`, `detailed`)
- include simple next actions toggle
- speech rate
- working sound variant and volume
- TTS voice selection

Important current implementation note:

- response scope and next-actions settings do not change app layout; they only shape the generated system prompt sent to the server

## Conversation Mode Detailed Behavior

Conversation mode is a hands-free loop around one active session.

Entry requirements:

- server must be connected
- no current send operation may be active
- no pending permission/question interactions may be present
- there must be or become an active session

Loop behavior:

1. Start listening continuously.
2. Collect transcript from speech recognition.
3. When a final result settles, submit it as a prompt.
4. Wait until the session is no longer running.
5. Detect the latest assistant reply after the submission baseline.
6. Speak the assistant reply.
7. If configured, return to listening. Otherwise stop.

Additional behavior:

- screen is kept awake while conversation mode is active
- screen brightness is dimmed when possible
- a full-screen overlay is shown
- conversation mode stops if the assistant requires on-screen permission/question input
- speech/TTS failures surface feedback and may stop the mode

## Notifications Behavior

The app attempts to notify when an OpenCode task completes.

Behavior:

- when a prompt is sent, a pending notification tracker is stored locally with connection credentials and project path
- while the app is active, completion can be detected by local provider state and trigger a local notification
- on supported native platforms outside Expo Go, a background task checks pending sessions periodically and emits task-complete notifications

Parity implication:

- notification tracking is coupled to prompt submission and session status transitions
- a rewrite should preserve both in-app completion flushing and background completion checking

## Persistence Requirements

The following values are persisted locally:

- connection settings
- chat preferences
- active project path
- last session ID by project
- pending notification sessions

The following values are not persisted and are rebuilt from the server:

- session list
- session statuses
- messages
- diffs
- todos
- pending requests
- provider/model/agent catalog

## User-Visible Edge Cases

- If no project exists yet, Chat shows a `Choose a workspace` prompt.
- If a project exists but no session is ready yet, Chat shows a loading panel.
- If connection fails, error copy is shown in the landing/loading states and inside chat content.
- If speech input is unavailable or denied, user-friendly errors are shown.
- If TTS cannot speak a message, a snackbar error is shown.
- If sending fails, draft text and attachments are restored locally.

## Parity Checklist

Any reimplementation should preserve these functional outcomes:

- automatic reconnection after local settings hydration
- workspace-first session scoping
- remembered last session per project
- transcript + diff + todo + pending-request surfaces
- session archive / unarchive support
- provider discovery and auth configuration from server metadata
- enabled-model filtering separate from model selection
- auto-approve writing back to server permissions config
- attachment conversion from mobile-local URIs to data URLs
- SSE updates with polling fallback
- task-complete notification tracking
- optional conversation mode with listen -> submit -> wait -> speak -> listen loop
