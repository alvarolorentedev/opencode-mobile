# Functional Specification

## Product Purpose

The mobile app is a client for interacting with an OpenCode server from a phone or tablet. It is optimized for:

- selecting a workspace hosted by the server
- opening or creating chat sessions tied to that workspace
- sending prompts and files to OpenCode
- tracking transcript, file changes, todos, and blocking requests
- configuring providers, models, and voice behavior
- editing workspace text files, managing worktrees/MCP servers, and using project PTYs
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

Chat has a workspace button in its chat library. Workspace keeps its project-name dropdown in the header. Both open the same anchored project picker for projects returned by the server.

Behavior:

- projects are deduplicated by worktree path
- projects are sorted by most recently initialized/created first
- the active project can be selected from the list
- selecting a project clears the current session selection
- the provider later rehydrates or creates the appropriate session for that project
- the current server project may be labeled `Current`; the selected app project may be labeled `Active`
- Add workspace accepts a directory on the OpenCode server, resolves its project, refreshes the catalog, and selects it; an invalid directory stays in the form with an error

### 3. Open or Create a Chat Session

The app maintains one active session at a time for the active project.

Bootstrapping behavior:

- if a transient deep-link target exists for the project (see below), that session is opened instead
- if a remembered session exists for the project and still exists on the server, it is reopened
- otherwise the latest available session is used
- if no session exists, one is created automatically

A stale deep-link target that does not match any session returns a not-found error and never synthesizes a new one.

Manual behavior:

- user can create a new session from the Chat header
- user can open the Chats overlay from the Chat title to search, switch, favorite, archive, and manage sessions; its header opens a second overlay to change workspace

### 3b. Open a Session via Deep Link

The app supports deep links that open a specific session:

`opencodemobile://session/<sessionId>?project=<url-encoded project path>`

Behavior:

- the link opens the session belonging to the given server project path
- if the project differs from the active project, the app switches to it (and persists it as the active project)
- if the session is not found in that project, a `Could not open session` error screen is shown with the server message
- the link does not carry a server identity; it resolves against the currently configured server
- only sessions that appear in the project's session list can be opened; archived sessions are not reachable this way

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
- the selected model must advertise attachment support
- local files larger than 10 MB are rejected before base64 encoding
- request body includes selected agent, selected model, and generated system prompt derived from preferences

After submission:

- active session is refreshed
- transcript, diff, and todos are refreshed
- untitled sessions are summarized using the selected model when possible
- a pending local-notification tracker is created for the session

### 5. Watch the Session Progress

The Chat screen shows:

- transcript messages
- inline running status text while OpenCode is active
- floating permission actions or a full-screen question flow if OpenCode is blocked waiting for the user
- a changes tab with current file diffs
- todos when provided by the server

Behavior details:

- only user messages and assistant messages with text or errors appear in the main transcript
- reasoning and tool activity are summarized and attached to assistant messages as metadata chips
- a status line like `OpenCode is ...` is shown while running and not blocked on user input
- a small floating progress view shows the current step and completed count; tapping it opens a content-sized overlay with the task list; pending permission actions replace it while blocked
- a pending question opens a full-screen answer flow immediately; dismissal leaves an `Answer needed` card above the composer and does not reject the request

### 6. Resolve Pending Interactions

Each permission request shows:

- a title derived from `permission`
- optional pattern list
- action buttons: `Allow once`, `Always allow`, `Deny`

Permission behavior:

- requests are received from the global event stream and list API, then stored under `sessionID`
- only interactions for the current or sending session are displayed
- replies use `/permission/{requestID}/reply`
- the replied request is removed locally and that session's messages are refreshed

The full-screen question flow shows one visible question at a time with Back and Next, then submits on the last step. Drafts survive dismissal and reopening. It preserves question order, multiple selections, custom answers, defaults, and conditional visibility. V2 forms additionally render field types (`boolean` as a switch, `number`/`integer` with a numeric keyboard, `external` as an open-link action), respect `required` and `when` conditions, and show the form `title`. A failed submission keeps the answers for retry. V2 MCP elicitation forms owned by the server's `global` sentinel are surfaced with the active chat rather than dropped.

### 7. Inspect File Changes

The `Files Changed` tab can read several diff sources from the OpenCode API. A single source button opens the shared overlay to choose the scope and, when applicable, the turn.

Behavior:

- scopes: `Turn` (per-user-message snapshot diff), `Uncommitted` (VCS working tree), `Branch` (VCS diff against the default branch)
- `Turn` is the default and shows the latest user turn; the source overlay lists earlier turns when more than one user turn has a recorded diff
- `Uncommitted` and `Branch` call `vcs.diff` with modes `git`/`working` and `branch` respectively and are workspace-scoped, not session-scoped: V1 scopes with the `directory` query parameter, V2 with `location[directory]`
- top card shows the active scope title, line totals, and current status
- `{ file, patch, additions, deletions }` diff objects are rendered as expandable line previews
- if the turn message diff is empty, transcript patch details can still show filename-only entries
- per-scope empty states: `No file changes yet.`, `No uncommitted changes.`, `No changes against the default branch.`
- pull-to-refresh reloads the active scope; VCS scopes have no SSE event and are refreshed on demand (scope change, pull-to-refresh, or a workspace file save while a VCS scope is active)

### 8. Manage Sessions in the Chat Library

The Chats overlay opened from the Chat title provides lifecycle operations through swipe-left row actions:

- open a session
- create a new session
- rename a session
- permanently delete a session after confirmation
- archive a session without deleting it
- restore or permanently delete sessions shown by the experimental archived-session list
- share a session and copy its URL, or unshare it

Session list behavior:

- search filters the active, favorite, or archived list
- favorites remain accessible across workspaces; choosing one switches to its project
- the Active tab opens with an "Active across workspaces" group above Favorites listing up to four sessions from the whole connected server: running (busy/retry) sessions first, then the most recently updated idle ones. It is connection-wide, so it stays the same while switching workspaces. Subagent chats are hidden by the same switch as the rest of the library, and listed sessions are removed from the Chat list below so they never appear twice
- picking a session from that group switches to its project and opens it in one tap, reusing the deep-link flow; the group is refreshed when the library opens and polled while a session is running
- project-scoped row actions (rename, share, archive, delete) are offered only for sessions in the active workspace, where the scoped client can act on them; other-workspace rows offer open and favorite
- each session row shows title, preview/subtitle, and status
- active session rows are visually emphasized
- the `Hide subagent chats` switch sits beside the Active and Archived filters in the library

Additional session actions are available in Chat:

- fork a session from a user message and open the fork
- revert a session from a user message
- undo the current revert

### 9. Inspect And Edit Workspace Files

The Workspace tab provides source inspection and text editing:

- Files and Worktrees use the same top-tab style as Chat
- search file paths by query
- open returned files in a focused full-screen viewer/editor
- show the number of changed files from file status
- show the current VCS branch when available
- edit the selected text file and save the complete replacement as a VCS patch

Before save, the provider re-reads the file and rejects the operation if the server content differs from the content originally opened. Only non-base64 text files are editable; a successful full-file patch is followed by another read and workspace-status refresh.

### 10. Manage Worktrees

The Workspace tab can list, create, reset, and remove worktrees. Creation accepts an optional name and start command; reset and remove require destructive confirmation. These SDK operations use OpenCode's experimental worktree endpoints, so server availability and response stability are not guaranteed like the non-experimental contract.

### 11. Use The Terminal Tab

The fourth tab uses a content-sized terminal selector overlay. The plus action creates a PTY with the server default shell (which falls back to bash on the fake server); tapping a row opens it, and swiping left reveals its Close action. Rows show a short terminal ID to distinguish terminals with the same title and command. Users type directly into xterm; each committed input is sent immediately. The remote shell handles history, completion, editing, and Enter.

The provider requests a short-lived PTY connect ticket and opens a project-scoped `ws:`/`wss:` connection. The UI uses xterm for ANSI/VT cursor behavior, alternate-screen programs, and 10,000-line scrollback. A system-keyboard accessory provides Esc, Tab, sticky modifiers, arrows, and an expandable function/navigation/paste row. Opened displays survive tab and terminal switches; reconnect uses acknowledged cursors and fresh tickets.

## Chat Screen Detailed Behavior

## Empty State

When a session has no display transcript yet, the user sees:

- `Start a new task`
- descriptive copy about specific prompts
- tappable starter prompts that immediately send predefined text

## Overlay and Back Navigation

Overlays are dismissible with the platform back action. On Android, pressing the hardware back button while an overlay is open dismisses that overlay and keeps the current screen in place; a second back press then performs the underlying navigation. Overlay sheets (chat library, session usage, workspace and terminal pickers) share this behavior through `OverlaySheet`, and the conversation-mode overlay stops the mode on back. Native modal surfaces (dialogs, model picker, file details, select pickers) follow the same dismiss-first rule through their own back handling.

## Transcript Behavior

- transcript is paginated from the bottom using a fixed page size
- `Load earlier messages` reveals older transcript entries
- automatic scroll-to-end happens for new content unless the view is currently paginating older items
- long-pressing a message copies its text/error content
- assistant messages can be played with TTS if they contain readable text

## Composer Behavior

Server-owned tasks appear in a compact floating progress view. Tapping it opens a content-sized, scrollable overlay without resizing the composer.

The composer includes:

- agent picker
- model picker
- reasoning picker
- auto-approve toggle
- optional conversation mode banner
- slash-command suggestions when the draft starts with `/` and has no space
- attachment chips
- text input

Agent, model, reasoning, and auto-approve use the original four visible controls. The outer composer button adds an attachment when the draft is empty, sends when it has content, and stops a running session.
- primary and secondary action buttons

Primary action rules:

- if the session is running and there is no draft content, the main action becomes `stop`
- otherwise the main action is either `attach` or `send`

Secondary action rules:

- with content present, the secondary button attaches files
- without content, the secondary button toggles microphone dictation

Slash command behavior:

- commands are loaded from the server for the active project
- up to six command names matching the current prefix are suggested
- an exact known `/command` submission is sent through the session command API with the remaining text as arguments
- attachments prevent command interpretation and use normal prompt submission

## Abort Behavior

When a session is running and there is no draft content, the main composer action aborts the active session.

Abort behavior:

- clears pending completion notification tracking for the session
- calls the server abort endpoint
- refreshes sessions, messages, diff, and todos

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
- the picker shows the provider alongside the selected model, groups results by provider, and searches provider/model names and IDs
- the picker pins the currently selected model and the recently used models at the top; these sections hide while a search query is active
- selecting a model updates both `providerId` and `modelId` and records the model in the recent list
- the initial model follows the server config (`GET /config` -> `model`, variant-tolerant); a stored selection wins when still available
- when neither the stored nor the server-configured model resolves, no model is auto-picked: the picker shows `Select model` and prompts are sent without a model so the server default applies, instead of silently sending a possibly blocked model
- discovered model metadata comes from nested attachment/input modality, tool-call, reasoning, status, and context/output limit capabilities
- reasoning level affects only the generated system prompt, not local control flow

## Session Title Summarization

If a session has no title after a prompt is sent, the app asks the server to summarize the session title using the selected model.

If summarization fails, the session simply remains untitled.

## Settings Screen Detailed Behavior

### Connection Section

Lists the connections the user has saved plus the connection currently in use.

Behavior:

- each connection is a collapsible row; expanding shows its server URL and username, and reveals Connect, Edit, and Delete for that connection
- the active row shows an `Active` (or `Connecting`) badge; the active connection always has a row, titled `Current connection` while it has not been saved as a profile yet
- `Add connection` opens a scrollable full-screen form for name, server URL, username, and password; the keyboard-safe primary action is `Save & connect`, which stores the profile (password in SecureStore, metadata in AsyncStorage) and switches to it
- `Edit` opens the same form for that connection: for a saved connection it updates the stored profile (and the live settings when it is active), for the current unsaved connection it updates the live settings only
- editing the active connection never reconnects on its own; the row's Reconnect action does that, so an in-flight session is not dropped
- the active connection cannot be deleted; other connections offer Delete with a confirmation
- selecting Connect on another connection switches through `switchConnection()`, which persists the outgoing profile's model selection, restores the target profile's selection, clears all server-derived state, and reconnects with the target credentials
- values are persisted locally; passwords stay in SecureStore while name, URL, and username live in AsyncStorage
- Settings shows short category summaries in one compact group; tapping Connection opens a content-sized overlay with the server message, last checked timestamp, and saved connection rows

### AI Defaults Section

Purpose:

- show configured providers
- add additional providers
- control which configured models appear in chat

Behavior:

- providers that expose a key/OAuth login method (or a V1 generic API-key fallback) appear in a searchable `Add provider` selector; providers with no interactive method are omitted. Already-configured providers stay listed (marked "add another account") so another account can be added for any provider
- configured providers display as chips, and OpenCode 2 providers with stored credentials show their labeled accounts with the active one marked; tapping an inactive account switches to it and the close action removes it
- configured providers display as chips
- models are grouped by provider in accordions
- each model can be toggled on/off from the enabled list
- if all stored enabled models disappear, all currently available configured models become enabled by default

### Provider Configuration Behavior

The app supports two auth styles:

- OAuth
- API/manual auth

Behavior:

- provider auth metadata comes from the server; V2 integration forms map into the same prompt model (text/select/number/integer/boolean/multiselect/external with `when` conditions)
- if the server returns no auth methods for a non-known-OAuth provider, the app falls back to a generic API-key flow
- provider setup is a full-screen two-step flow: pick a login method from a dropdown, then configure it; the dropdown dismisses on selection and the step advances
- OAuth routing is driven by the server's returned method, not by the presence of instructions; `auto` never asks for a code, `code` collects one
- `auto` OAuth (loopback callback or device/pairing flow) shows any pairing code and instructions with explicit copy controls plus an open/copy link action, opens the browser, and polls the server attempt until it completes (bounded, fifteen minutes, matching device-code expiry); after the user enters the code on the provider site the app finishes on its own
- `code` OAuth shows the instructions and link, opens the browser, and collects the authorization code on the setup step; a redirect back to the app scheme is captured opportunistically and submitted directly, but is not required
- pairing/device codes live inside the server's instruction text; the app best-effort extracts the code into its own copyable field and always shows the full instruction text
- dismissing a pending OAuth flow cancels the server attempt on OpenCode 2
- if API auth is selected, auth values are normalized and sent to `client.auth.set` (V1) or the V2 credential endpoint
- after successful auth, the provider is enabled in server config and capabilities are refreshed
- configured providers can be removed, deleting stored credentials and disabling the provider in config
- on OpenCode 2 a provider's stored credentials are listed as labeled accounts; one is active, and the user can switch the active account or remove an account. A provider's accounts are those credentials whose integration serves one of the provider's login methods
- the Add provider picker lists every provider with an interactive login method, including already-configured providers (with an "add another account" hint), so a second account can be added for any provider

### Notifications Section

Purpose:

- help the user enable local notifications for task completion
- show a debug-style summary of notification readiness

Behavior:

- on supported platforms, permission status is read from the system
- Android users can be deep-linked to notification settings and battery-related settings
- `Enable notifications` requests permission and refreshes status
- startup initializes notification handling without displaying a permission prompt
- `Refresh status` re-queries permission and background-task registration state

### Diagnostics Section

- reports `/global/health` status and OpenCode version when available
- reports global event stream state, describing non-connected states as polling fallback
- reports MCP, LSP, and formatter counts when their endpoints are available
- each diagnostic request fails independently and can be refreshed manually

### MCP Servers Section

- adds local MCP commands or remote MCP URLs
- refreshes status and connects or disconnects servers
- enables/disables and removes configuration through config updates
- starts remote OAuth in the browser and submits an authorization code callback

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
- voice check (microphone/speech permission, recognition availability, on-device support, and a playback test) with an app-settings shortcut

Working sound runs while a prompt is being submitted or any session is non-idle when enabled. It is stopped while conversation mode is listening or speaking and after work becomes idle.

Voice input degrades gracefully on iOS instead of failing outright:

- recognition availability is re-checked when listening starts, not only on mount
- an on-device attempt that fails because the language model is missing, or because Siri/Dictation is off, retries once through network recognition before surfacing an error
- errors are classified so the UI can offer the right next step: retry (including re-prompting while the OS still allows it), open app settings after a denial, or no action when device policy restricts speech recognition
- speech playback validates the selected voice and falls back to the system default when it no longer exists, and a watchdog reports an error if the synthesizer never starts or finishes

Existing configuration is unchanged: the on-device toggle still prefers local recognition, and onboarding only requests permission when the user chooses to enable voice.

Important current implementation note:

- response scope and next-actions settings do not change app layout; they only shape the generated system prompt sent to the server

### Language Section

Purpose:

- choose the app interface language, or follow the system default

Behavior exposed today:

- options are built from the supported language list (English source plus Spanish, Hindi, German, French, Simplified Chinese, Portuguese, and Japanese)
- `System default` follows the OS locale; an explicit choice overrides it
- the choice is persisted with chat preferences and applied immediately
- the interface language also drives `Intl` date, number, currency, and relative-time formatting

### Support Section

Purpose:

- let users rate the app, send improvement feedback, or reach the support page

Behavior exposed today:

- `Rate us on Play Store` opens the Play Store listing, shown only on Android builds without the foss variant
- `Give us feedback` opens the GitHub issue tracker
- `Open support page` opens `https://getopencode.app/support/` in the browser
- no provider state or persistence; the section only opens external URLs

## Conversation Mode Detailed Behavior

Conversation mode is a hands-free loop around one active session.

Entry requirements:

- server must be connected
- no current send operation may be active
- no pending permission or question interaction may be present
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
- a full-screen overlay is shown
- conversation mode stops if a permission or question requires on-screen input
- speech/TTS failures surface feedback and may stop the mode

## Notifications Behavior

The app attempts to notify when an OpenCode task completes.

Behavior:

- when a prompt is sent, a pending notification tracker is stored locally with a non-secret connection reference (server URL, username, connection scope) and project path; passwords stay in SecureStore
- pending records are keyed by connection scope + session ID, so a task started on one server survives switching to another
- while the app is active, completion can be detected by local provider state and trigger a local notification
- on supported native platforms outside Expo Go, a background task checks pending sessions periodically, resolves each record's own connection credentials, and emits task-complete notifications; a record whose credentials cannot be resolved yet is kept for a later run rather than discarded

Parity implication:

- notification tracking is coupled to prompt submission and session status transitions
- Android native builds automatically show one silent ongoing activity notification
  for all tasks on the connected server, including other workspaces and desktop
  tasks. It shows the active count and selected task's tool, thinking, retry,
  queued, or needs-input state. Subagents count as their root task. Notification
  taps open the owning connection, workspace, and session.
- While work is monitored, an Android foreground service keeps provider SSE and
  polling alive when the app is backgrounded or locked. Android 16+ is asked to
  promote the notification to a status-bar chip; OS settings and device support
  determine whether it appears. Older devices use a normal ongoing notification.
- Once all tasks finish, monitoring stops and the same notification becomes a
  dismissible silent result. Failed or interrupted tasks show their actual state.
  No notification is posted before activity. Stop monitoring and dismissal leave
  server jobs running and suppress that notification cycle until a new task starts.
- Idle background discovery is not continuous: desktop work started afterward
  is discovered when the app resumes. Foreground discovery polls every 20 seconds,
  with events triggering reconciliation; monitored work polls every 5 seconds.
  Force-stop, removing the app from Recents, and process termination end live
  monitoring. Android service timeouts leave a silent monitoring-paused result.
- Android completion notifications use a silent channel, including the periodic
  fallback. iOS completion behavior is unchanged. Live activity requires a rebuilt
  native app and is disabled on web, Expo Go, and E2E runs.
- a rewrite should preserve both in-app completion flushing and background completion checking

## Persistence Requirements

The following values are persisted locally:

- connection settings and saved connection profiles (credentials only in SecureStore)
- chat preferences (per active connection; each profile also keeps its model selection)
- active project path
- last session ID by connection scope and project
- session list/status caches by connection scope and project
- favorites, each carrying its connection scope
- pending notification sessions, each carrying its connection scope

The following values are not persisted and are rebuilt from the server:

- session list
- session statuses
- messages
- diffs
- todos
- pending permissions and questions
- provider/model/agent catalog
- commands, workspace file results/status/content, VCS info, worktrees, MCP statuses, PTYs, terminal output, archived sessions, and diagnostics

## User-Visible Edge Cases

- If no project exists yet, Chat shows a `Choose a workspace` prompt.
- If a project exists but no session is ready yet, Chat shows a loading panel.
- If connection fails, error copy is shown in the landing/loading states and inside chat content.
- If speech input is unavailable or denied, a user-friendly error is shown with a recovery action (retry, or open app settings after a denial).
- If on-device recognition cannot run for the chosen locale, it retries through network recognition before showing an error.
- If TTS cannot speak a message, a snackbar error is shown.
- If sending fails, draft text and attachments are restored locally.
- Send failures remain visible until dismissed, include asynchronous `session.error` events, and can be copied with session/model context for diagnostics.

## Parity Checklist

Any reimplementation should preserve these functional outcomes:

- automatic reconnection after local settings hydration
- workspace-first session scoping
- remembered last session per project
- transcript + diff + server-owned todo + permission surfaces
- session delete, archive/restore, rename, fork, revert/unrevert, and share/unshare support
- slash command discovery and execution
- workspace file search/view/status plus conflict-checked full-file VCS patch save
- experimental worktree management and archived-session listing
- MCP lifecycle/configuration/OAuth management
- ticket-authenticated interactive PTYs with xterm, bounded scrollback, resize, and acknowledged reconnect
- server diagnostics
- provider discovery and auth configuration from server metadata
- enabled-model filtering separate from model selection
- auto-approve writing back to server permissions config
- attachment conversion from mobile-local URIs to data URLs
- attachment capability enforcement and 10 MB local-file limit
- reconnecting global SSE filtered to the active project, with polling fallback for refreshable session data
- task-complete notification tracking
- optional conversation mode with listen -> submit -> wait -> speak -> listen loop
