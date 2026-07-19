# API Contract

## Scope And Compatibility

This is the client-side OpenCode contract implemented by the app. The code targets `@opencode-ai/sdk` 1.18.3 and imports generated request and response types directly. It is latest-only support: the app does not carry compatibility shims for older OpenCode endpoint shapes.

The authoritative implementation is:

- `lib/opencode/client.ts`
- `lib/opencode/types.ts`
- `providers/services/*.ts`
- `providers/opencode-provider.tsx`

## Client Construction

`buildClient()` passes these options to `createOpencodeClient()`:

- normalized `baseUrl`
- optional project `directory`
- optional Basic Authorization header
- a scoped fetch that preserves a configured URL path prefix
- `responseStyle: 'fields'`
- `throwOnError: true`

Two clients are used:

- project-scoped `client` for session, capability, command, file, VCS, worktree, MCP, and PTY operations
- unscoped `catalogClient` for project discovery, diagnostics, and global events

The app retains only the scoped directory as client metadata so stale project responses can be ignored.

## Endpoint Families

The generated `@opencode-ai/sdk/v2/client` surface is used for all OpenCode requests:

- path, project list, and current project discovery
- config get/update
- provider list and auth metadata
- provider OAuth authorize/callback and credential write
- agent and command listing
- session list/status/create/delete/update
- session messages, diff, todos, prompt, abort, summarize, and command
- session fork, share/unshare, and revert/unrevert
- session archive/restore and experimental archived-session listing
- permission and question list/reply operations
- global event streaming
- file find/read/status, VCS information, and VCS patch apply
- experimental worktree list/create/reset/remove
- MCP status/add/connect/disconnect/OAuth and config-backed enable/disable
- PTY shell/list/create/remove/connect-token plus WebSocket streaming
- LSP and formatter status

The service layer also exposes current SDK helpers for file listing, text/symbol search, VCS status/diff, and session children/init/shell. They are covered by the fake-server contract but are not currently wired to a user-facing provider action.

## Workspace Discovery

The catalog client loads these requests concurrently:

- `path.get()`
- `project.list()`
- `project.current()`

`path.get()` must return a `directory`. Projects are deduplicated by `worktree`; the current project is included even if omitted from the project list.

## Capability Discovery

For an active project, the app loads:

- `config.get()`
- `provider.list()`
- `provider.auth()`
- `app.agents()`

Provider models are flattened to app options. Capability discovery uses the current nested model fields:

- `id` and `name`
- `capabilities.attachment`
- `capabilities.input`
- `capabilities.toolcall`
- `capabilities.reasoning`
- `status`
- `limit.context`
- `limit.output`

`capabilities.attachment` controls whether the composer may send files. Enabled entries in `capabilities.input` define the accepted input modalities. Legacy top-level capability fields are not supported.

## Provider Authentication

### Credential Write

`client.auth.set()` receives the provider ID as path parameter and one of these bodies:

```json
{ "type": "api", "key": "sk-..." }
```

```json
{ "type": "wellknown", "key": "name", "token": "token" }
```

After credential storage, the provider is enabled in config and capabilities are refreshed.

Removing a provider calls `client.auth.remove()`, disables it in config, and refreshes capabilities.

### OAuth Authorization And Callback

Authorization calls `client.provider.oauth.authorize()` with:

```json
{ "method": 0 }
```

The response must contain:

- `url`
- optional `instructions`
- `method: "auto" | "code"`

The URL is opened in the system browser. For `code`, Settings collects an authorization code and calls `client.provider.oauth.callback()` with:

```json
{ "method": 0, "code": "returned-code" }
```

An empty trimmed code is sent as `undefined`, although the current dialog disables completion until text is present. A successful callback enables the provider and refreshes capabilities. For `auto`, the app enables the provider and reconnects after browser completion.

## Session Contract

### List And Status

`session.list()` and `session.status()` are fetched together. Sessions are sorted descending by `time.updated`; any status other than `idle` is treated as busy.

Fields consumed by the UI include:

- `id`
- `title`
- `summary`
- `time.created` and `time.updated`
- `share.url`
- `revert`

### Create, Rename, And Delete

- create uses `session.create()` with no body or `{ "title": "..." }`
- rename uses `session.update()` with `{ "title": "..." }`
- delete uses `session.delete()` and clears that session's local message, diff, todo, and permission caches

Deleting the current session also clears current selection before the list is refreshed.

### Archive And Restore

Archive and restore use regular `session.update()` with `time.archived` set to `Date.now()` or `0`. The archived list comes from `experimental.session.list({ archived: true })`, returns cross-project `GlobalSession` records, and is sorted by update time. The list endpoint is experimental and may be absent or change across OpenCode releases; the app does not provide a compatibility fallback.

### Fork

`session.fork()` receives an optional body:

```json
{ "messageID": "message-id" }
```

The returned session is required. The app refreshes sessions and opens the fork.

### Share And Unshare

`session.share()` and `session.unshare()` must return the updated session. Workspace copies `share.url` after a newly shared session returns one.

### Revert And Unrevert

Revert sends:

```json
{ "messageID": "message-id", "partID": "optional-part-id" }
```

The current UI supplies a user message ID and no part ID. Revert and unrevert refresh sessions, messages, and diff. A session with `revert` shows a restore action.

### Messages, Diffs, And Todos

The app reads:

- `session.messages({ sessionID })`
- `session.diff({ sessionID, messageID })`
- `session.todo({ sessionID })`

The Files Changed surface shows the latest user message's diff. The app loads the session messages, selects the latest user message, and supplies its ID to the message-scoped diff endpoint. Diff responses use the current `{ file, patch, additions, deletions, status }` shape directly. When no structured diff is available, transcript patch parts can still supply filename-only entries; current workspace file state is not treated as session history. Missing response data is a contract error rather than an empty result. Todos are server-owned; the UI renders their `status` and never sends a todo mutation.

### Prompt And Attachments

Prompt submission uses `session.promptAsync()` with:

- selected `agent`
- selected `{ providerID, modelID }`
- optional generated `system` instructions
- text and file `parts`

Before send:

- attachments are rejected if the selected discovered model has `capabilities.attachment: false`
- non-HTTP attachment URIs, including `file://`, `content://`, and `asset://`, are read and encoded as data URLs
- a local file over 10 MB is rejected before encoding
- remote `http:` and `https:` URLs pass through unchanged

### Abort And Summarize

- abort uses `session.abort()` and refreshes session content
- summarize uses the selected provider/model for untitled sessions; failure leaves the title unchanged

## Slash Commands

Commands are loaded with `command.list()`. An exact known draft of the form `/name arguments` with no attachments calls `session.command()` with:

```json
{
  "command": "name",
  "arguments": "arguments",
  "agent": "build",
  "model": "provider/model"
}
```

`agent` and `model` reflect current chat preferences. Messages and sessions are refreshed after execution.

## Workspace Contract

`workspace-service.ts` wraps these SDK operations:

- `find.files()` with `query` and a string `dirs` flag
- `file.read()` with `path`
- `file.status()`
- `vcs.get()`
- `vcs.apply()` with a generated full-file unified patch

Search is path-based, status is shown as a changed-file count, and VCS contributes the branch label. Saving is limited to text content: the provider first re-reads the path and compares it with the expected original, generates a safe relative-path full-file patch, calls `vcs.apply()`, then re-reads the saved file. A mismatch is a conflict and requires reopening the file.

## Experimental Worktree Contract

`worktree.list()`, `worktree.create()`, `worktree.reset()`, and `worktree.remove()` map to experimental worktree endpoints. Creation sends optional `name` and `startCommand`; reset/remove identify the worktree by directory. Create/remove also refresh project discovery. These endpoints are experimental and have no fallback for unsupported or changed server versions.

## MCP Management Contract

MCP management uses `mcp.status()`, `mcp.add()`, `mcp.connect()`, `mcp.disconnect()`, `mcp.auth.start()`, and `mcp.auth.callback()`. Additions are also written through `config.update()` because dynamic `mcp.add()` state is not durable. Local commands use a JSON string array so arguments and paths with spaces remain intact; remote additions send a URL. Remote OAuth opens the returned authorization URL and submits the entered code. SDK 1.18.3 has no MCP deletion operation, and config updates deep-merge omitted keys, so the UI supports disabling rather than falsely reporting removal.

## PTY Terminal Contract

The client uses `pty.shells()`, `pty.list()`, `pty.create()`, `pty.remove()`, and `pty.connectToken()`. Opening a PTY requests a short-lived ticket, converts the normalized server URL to `ws:` or `wss:`, preserves any configured path prefix, and connects to `/pty/{ptyID}/connect` with `directory` and `ticket` query parameters.

The ticket authenticates the WebSocket rather than placing Basic credentials in its URL. Incoming text/blob data is appended after common ANSI CSI stripping and truncated to the latest 100,000 characters. This is intentionally a line console, not full VT emulation.

## Diagnostics Contract

Diagnostics load four requests independently:

- `global.health()`, expected as `{ "healthy": true, "version": "..." }`
- `mcp.status()`, expected as a status record keyed by MCP name
- `lsp.status()`, expected as an array
- `formatter.status()`, expected as an array

Each result records either `{ available: true, data }` or `{ available: false, error }`. One unavailable endpoint does not fail the other diagnostic results.

## Pending Interaction Contract

Permissions and questions are session-scoped. The app reconciles `GET /permission` and `GET /question` results and also handles their global events.

`permission.asked` properties contain:

- `id`
- `sessionID`
- `permission`
- `patterns`
- `metadata`, `always`, and optional `tool`

The request is inserted or replaced in `pendingPermissionsBySession[sessionID]`. `permission.replied` removes the matching `requestID`.

A reply calls the generated session-scoped operation with:

```json
{ "reply": "once" }
```

Allowed values are `once`, `always`, and `reject`.

Question requests contain `id`, `sessionID`, and one or more question definitions with headers, prompts, options, and optional multiple/custom-answer behavior. Replies post ordered answer arrays to `/question/{requestID}/reply`; rejection posts to `/question/{requestID}/reject`.

## Global Event Stream

The catalog client opens `global.event()`. Each envelope contains a `directory` and `payload`; only envelopes matching the active project path are handled.

Recognized payload types:

- `session.created`
- `session.updated`
- `session.deleted`
- `session.status`
- `session.idle`
- `message.updated`
- `message.removed`
- `message.part.updated`
- `message.part.removed`
- `session.compacted`
- `session.diff`
- `todo.updated`
- `catalog.updated`
- `project.updated`
- `file.edited`
- `vcs.branch.updated`
- `pty.created`, `pty.updated`, `pty.exited`, and `pty.deleted`
- `worktree.ready` and `worktree.failed`
- `mcp.tools.changed` and `mcp.browser.open.failed`
- `lsp.updated`
- `permission.asked`
- `permission.replied`
- `question.asked`
- `question.replied`
- `question.rejected`

The subscription reconnects after failure or an unexpected end. It is considered connected only after the first matching project event arrives, so polling remains active while the SDK is still opening or retrying the stream. Backoff starts at 1 second, doubles after each failure, and is capped at 15 seconds. A successful event resets backoff to 1 second.

## Polling Fallback

A 5-second loop remains active while connected with an active project. Safety polling is used when SSE is not connected; busy sends, non-idle sessions, and conversation mode also drive refresh work.

Polling can refresh:

- session list and statuses
- current session messages, diff, and todos
- conversation session messages, diff, and todos when it differs from current
- pending permissions and questions
