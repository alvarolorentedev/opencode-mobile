# API Contract

## Scope And Compatibility

This is the client-side OpenCode contract implemented by the app. It supports two server contracts:

- OpenCode 1.x: unprefixed paths such as `/path` and `/session`, spoken through `@opencode-ai/sdk` 1.18.3 (`@opencode-ai/sdk/v2/client`). This is the app's domain type source and remains the default.
- OpenCode 2.x: `/api`-prefixed paths spoken through `@opencode/client` 2.0.12. A V2 adapter normalizes V2 responses and events back into the app's existing 1.x-shaped domain types.

`detectServerContract()` probes `/api/info`, `/api/health`, and `/global/health` concurrently. A `/global/health` response reporting a `1.x` version wins as V1, because newer 1.x servers also expose some `/api` compatibility routes. V2 is only selected when `/api/info` returns a V2 `ServerInfo` shape (`version` plus `pid`/`urls`/`paths`) or `/api/health` reports `healthy: true` without a 1.x signal. The resolved contract is stored in provider state and selects which client `buildClient()` constructs.

Because a probe can still misclassify a hybrid server, `connect()` tries the detected contract first and falls back to the other one when workspace discovery fails with a contract-mismatch error (`UnsupportedContentType`, `UnexpectedStatus`, `MalformedResponse`, or an HTML response). Only after both fail is a connection error surfaced.

Setup uses `probeConnection()` directly. Its outcomes are `detected` (contract and
optional version), `authentication-required` (401/403), `unreachable` (all requests
fail), and `unknown` (reachable without a recognized contract). Each request has
a five-second timeout and supports cancellation. `detectServerContract()` remains
the compatibility wrapper with the existing V1 fallback for connection attempts.

### Local V2 pairing

V2 accepts the fixed Basic-auth username `opencode`; a blank stored username
already resolves to it in the shared transport. The password may be a configured
password or a session token. See [upstream authentication](https://github.com/anomalyco/opencode/blob/v2/packages/server/src/auth.ts).

`lib/opencode/pairing.ts` accepts current `{code, urls}` QR JSON and HTTP(S)
`/auth/connect/<code>` links, including a proxy path prefix. It redeems a code via
GET with `Accept: application/json`, expects `{token}`, and returns a clean server
URL with that token as the password. It also accepts older `{urls, username:
"opencode", password}` JSON and base64 credential links at `/connect#<data>` or
`/connect?data=<data>`. See [upstream pairing](https://github.com/anomalyco/opencode/blob/v2/packages/app/src/servers/connect/pairing.ts)
and the [server contract](https://github.com/anomalyco/opencode/blob/v2/packages/protocol/src/groups/server.ts).

Payload size, code syntax, credentials and HTTP(S) addresses are validated before
requests. Distinct non-loopback addresses are tried in payload order, with a
five-second timeout per address. Redemption rejects redirects through Expo's
native transport, since React Native's XHR ignores redirect mode.
Invalid/used/expired codes can be replaced by a
new scan; loopback-only and unreachable payloads offer manual/network guidance.
Pairing secrets never become profile metadata or saved URL paths/query/hash.

The V2 adapter is best-effort and does not cover every 1.x feature. Unsupported on V2: session share/unshare, archive/restore, title summarization (`summarize`), `file.status`, `vcs.apply`, `find.text`/`find.symbol`, LSP and formatter diagnostics, and remote-MCP OAuth start/callback. These degrade to empty results or explicit errors. Server-owned session todos are not an endpoint on V2, but the adapter derives the same plan from the transcript's `todowrite` tool parts, so the todo surface is available on both contracts.

`getServerCapabilities(contract)` in `providers/opencode-capabilities.ts` turns the resolved contract into UI-facing flags (`share`, `archive`, `todos`, `summarize`, `fileSave`, `fileStatus`, `lsp`, `formatter`, `mcpOAuth`, `configWrite`, `worktreeReset`). The provider exposes them as `serverCapabilities`, and screens/components hide the corresponding actions on V2 instead of letting them fail at tap time. All flags are `true` for V1; `todos` is also `true` for V2 because it is derived client-side.

The authoritative implementation is:

- `lib/opencode/client.ts`
- `lib/opencode/v2-client.ts`
- `lib/opencode/v2/`
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
- file find/read/status, VCS information/diff, and VCS patch apply
- experimental worktree list/create/reset/remove
- MCP status/add/connect/disconnect/OAuth and config-backed enable/disable
- PTY shell/list/create/remove/connect-token plus WebSocket streaming
- LSP and formatter status

The service layer also exposes current SDK helpers for file listing, text/symbol search, VCS status, and session children/init/shell. They are covered by the fake-server contract but are not currently wired to a user-facing provider action. The VCS diff and raw-diff helpers are wired through the Files Changed diff scopes.

## Workspace Discovery

The catalog client loads these requests concurrently:

- `path.get()`
- `project.list()`
- `project.current()`
- adding a workspace resolves `project.current()` with that server directory (`directory` on V1, `location[directory]` on V2), then refreshes `project.list()`; the resolved worktree is selected

`path.get()` must return a `directory`. Projects are deduplicated by `worktree`; the current project is included even if omitted from the project list. A selected app workspace remains selected if a refresh omits it from `project.list()`; only when there is no selected path does discovery choose the server current project, then the first listed project. The active workspace path is persisted and restored during hydration.

Session links and Chat Library opening accept that active path even when it is absent from the catalog. Other explicitly named project paths must still be listed by the configured server; session existence is checked through the scoped session flow.

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

On V2, `modelToV1()` maps `capabilities.tools` and `capabilities.input`, and derives `capabilities.reasoning` from the model's provider compatibility fields and variants/settings because V2 has no explicit reasoning flag. Every entry in `Model.Info.cost` is mapped: the untiered entry becomes the base price and entries with a `tier` become `cost.tiers`, so tiered pricing estimates match V1 behavior.

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

Routing follows the returned `method`, not the presence of instructions:

- `auto`: the server completes the exchange (loopback callback or device/pairing polling). The app opens `url` when present, shows any instructions/pairing code with copy controls plus an open/copy link action, and polls the attempt until it completes. It never asks the user to paste a code.
- `code`: the provider expects a code back. The app opens `url`, shows the instructions/link, and collects the authorization code on the setup step. A redirect that returns to the app scheme is captured opportunistically and submitted directly, but is not required.

Device/pairing codes are embedded in `instructions` (`"Enter code: 8F43-6FCF"`); the app best-effort extracts the code into its own copyable field and always shows the full instruction text. Manual completion calls `client.provider.oauth.callback()` with:

```json
{ "method": 0, "code": "returned-code" }
```

An empty trimmed code is sent as `undefined`, and the dialog disables completion until text is present. A successful callback enables the provider and refreshes capabilities.

On V2, `auto` OAuth completes on the server after the browser hits the server's callback or the device flow is approved. Rather than guessing from the provider list, the adapter polls `integration.oauth.status` (`pending`/`complete`/`failed`/`expired`) through a `providerOAuth.wait(providerId, timeoutMs)` facade (default fifteen minutes, matching device-code expiry) and only then enables the provider. V1 has no attempt status and keeps bounded `provider.list()` polling. Dismissing a pending flow cancels the attempt through `providerOAuth.cancel(providerId)` on V2.

### Provider Auth Methods And Forms

`provider.auth()` returns the login methods per provider. V2 integration methods carry a rich `form` (string/select/number/integer/boolean/multiselect/external with `when` conditions) that the adapter normalizes into the app's prompt model, so the setup UI renders type-specific controls. V1 auth metadata (text/select with a single `when`) maps into the same model.

### Provider Accounts

OpenCode 2 stores credentials as first-class, labeled accounts. `GET /api/credential` returns `{id, integrationID, label, active, value}` for every stored credential and is the authoritative source for the active account; exactly one credential is `active` per integration. `integration.connect.key` and `integration.connect.oauth` accept an optional `label` and create a new credential, activating it unless one already exists. `POST /api/credential/:id/activate` switches the active account, `PATCH /api/credential/:id` renames it, and `DELETE /api/credential/:id` removes it. The provider layer surfaces these per provider as `ProviderOption.accounts`, associating a credential with every provider whose integration (its own id or a linked Console integration) serves one of the provider's login methods. The endpoint is newer than the pinned client; the adapter reads it through its own authenticated transport and treats a missing endpoint as "no accounts". V1 has a single credential per provider and no account list.

## Session Contract

### List And Status

`session.list()` and `session.status()` are fetched together. Sessions are sorted descending by `time.updated`; any status other than `idle` is treated as busy. The V2 adapter derives status from `session.active()`, whose running set cannot express `retry`, so the provider preserves an event-derived `retry` across list refreshes (see Global Event Stream) instead of letting a refresh downgrade it to idle.

Fields consumed by the UI include:

- `id`
- `title`
- `summary`
- `time.created` and `time.updated`
- `share.url`
- `revert`
- `model`, `tokens`, and `cost` for the usage sheet's context utilization

The V2 adapter maps `model`, `tokens`, and `cost` from `Session.Info` in `sessionToV1()`. Context utilization is the latest completed `step-finish`'s prompt plus its reply (`input + cache.read + cache.write + output`), not cumulative session totals, and all-zero placeholder steps are skipped while an assistant message is still in flight. The V2 adapter emits one `step-finish` part per assistant message, so "latest step" means "latest model call" on both contracts. V2 `Session.Info` has no `summary` field, so the session picker subtitle shows the no-file-changes fallback on V2 until a server-side summary exists.

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

The Files Changed surface has three diff scopes. The `turn` scope shows a single user message's diff: the app loads the session messages, selects the latest user message (or a user-selected earlier turn), and supplies its ID to the message-scoped diff endpoint. The `uncommitted` and `branch` scopes call `vcs.diff({ mode })` with `git` on V1 / `working` on V2, and `branch` respectively. Workspace scoping rides on the `directory` query parameter on V1 and on `location[directory]` on V2: the V2 server answers an unscoped VCS call with its own location's state, so the adapter attaches `location` to every VCS read (`vcs.get`, `vcs.status`, `vcs.diff`) instead of the caller's directory. The V2 adapter translates the VCS mode (`git` -> `working`, `branch` -> `branch`) and forwards `messageID` on `session.diff`; V2 also accepts a `committed` VCS mode that the shared two-scope UI does not expose. Diff responses use the current `{ file, patch, additions, deletions, status }` shape directly. When no structured turn diff is available, transcript patch parts can still supply filename-only entries; current workspace file state is not treated as session history. Missing response data is a contract error rather than an empty result. Todos are server-owned on V1; the UI renders their `status` and never sends a todo mutation. V2 has no todo endpoint, so the adapter derives the same `Todo[]` from the latest `todowrite` tool part in the transcript (`deriveTodosFromMessages` in `lib/opencode/format.ts`). On V2 the adapter maps the V1 `before` cursor onto V2's opaque cursor; the first page requests descending order and subsequent pages omit `order`, mirroring V1's newest-first backward paging. The app loads 20 messages per page: the newest page on session open and older pages as the user scrolls up, keeping at most 200 raw records in memory.

### Prompt And Attachments

Prompt submission uses `session.promptAsync()` with:

- selected `agent`
- selected `{ providerID, modelID }`
- optional generated `system` instructions
- text and file `parts`

The optional `system` instructions are built from chat preferences (`buildSystemPrompt`: reasoning level, response scope, next actions). V1 sends them as the prompt `system` field. V2 prompt input has no `system` field, so the adapter writes the same text to a session-scoped instruction entry (`opencode-mobile.chat-preferences`) with `PUT /api/experimental/session/{sessionID}/instructions/entries/{key}` and removes it when the preferences are empty. The server announces instruction changes at the next step boundary. If a V2 server does not expose the experimental endpoint, the adapter logs nothing and still sends the prompt.

V2 prompt submission returns HTTP 200 with a `{ data: SessionInbox.User }` admission response identifying the accepted input. Completion is observed through session events and message reads.

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

The client uses `pty.shells()`, `pty.list()`, `pty.create()`, `pty.update()` (size), `pty.remove()`, and `pty.connectToken()`. Opening a PTY requests a short-lived ticket, converts the normalized server URL to `ws:` or `wss:`, preserves any configured path prefix, and connects to `/pty/{ptyID}/connect` with `directory` and `ticket` query parameters.

The ticket authenticates the upstream WebSocket. Native sockets also send configured Basic-auth headers, which the Cloud Link proxy requires on upgrades; credentials never enter the URL. Incoming text/blob/ArrayBuffer data is decoded in order and written to xterm without stripping VT controls. NUL-prefixed binary JSON carries a numeric replay cursor; apply it after preceding output has been acknowledged, then increment for live output by its UTF-16 character count. Reconnect requests a fresh ticket and passes that cursor only while retaining the matching renderer. Size changes call `pty.update({ ptyID, size: { cols, rows } })`. There is no new wire protocol or client input replay.

Omitting the cursor requests the full retained replay; `-1` tails from the current
end. These units and replay semantics follow the upstream
[PTY service](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/pty.ts)
and [wire protocol](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/pty/protocol.ts).

### V2 PTY mapping

V2 mounts PTYs under `/api` and scopes them with `location[directory]` instead of `directory`. Every PTY endpoint must carry that location; mixing a scoped read with an unscoped lookup produces "PTY session not found". The adapter maps:

- `pty.list()` / `pty.create()` → `GET/POST /api/pty` with `location[directory]` from the active project, so listing and creation target the same location the UI is scoped to
- `pty.get()` / `pty.update()` / `pty.remove()` → `GET/PUT/DELETE /api/pty/{ptyID}` with the same `location[directory]`
- `pty.connectToken()` → `POST /api/pty/{ptyID}/connect-token` with `location[directory]`; the `x-opencode-ticket: 1` header is required and is sent both as the generated `PtyConnectTokenInput` field and as a request header
- WebSocket → `ws(s)://{origin}{prefix}/api/pty/{ptyID}/connect?location[directory]=…&cursor=…&ticket=…`

The connect token is short-lived and single-use; every open/reconnect requests a fresh one. The live terminal socket lives in the provider, so event handling for `pty.created`/`pty.updated`/`pty.exited`/`pty.deleted` must be registered in the provider event switch (not only the history replay path) or the terminal list stops reconciling after the first change.

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

A subagent's request carries the child session's `sessionID`. The active chat surfaces requests for the current/sending session and its full descendant subtree (resolved from each session's `parentID`), so nested prompts are presented on the root chat instead of being dropped.

### Saved permission rules (V2)

V2 persists "always allow" grants created by permission replies. The app lists
them through `api.permission.saved.list()` (mapped to `{ id, action, resource,
createdAt }`) and revokes one through `api.permission.saved.remove({ id })`.
These are exposed on the client as the optional top-level `savedPermissions`
surface (the V1-shaped SDK `permission` object does not type them) and are gated
by the `savedPermissions` server capability. V1 has no equivalent; the Settings
section is hidden there.

A reply calls the generated session-scoped operation with:

```json
{ "reply": "once" }
```

Allowed values are `once`, `always`, and `reject`.

Question requests contain `id`, `sessionID`, optional `title`, and one or more question definitions with headers, prompts, options, and optional multiple/custom-answer behavior. Replies post ordered answer arrays to `/question/{requestID}/reply`; rejection posts to `/question/{requestID}/reject`.

The app owns the `PendingQuestionRequest`/`PendingQuestionPrompt` shape rather than aliasing the V1 SDK type, so the V2 adapter can carry form-specific metadata: per-option `value`, field `type` (`string`, `number`, `integer`, `boolean`, `multiselect`, `external`), `required`, `placeholder`, `default`, `url`, and conditional `when` rules. The UI submits option labels; the V2 adapter translates them back to option values and coerces numeric/boolean answers before posting the form reply.

`listPendingInteractions` fetches permissions and questions independently (`Promise.allSettled`) and returns whichever succeeded, so a failing form or permission list cannot hide the other surface. On V2 both list calls are scoped with `location[directory]` to the active project; V2 MCP elicitation forms use the server's `global` sentinel and are surfaced with the active chat instead of being dropped.

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

`mcp.browser.open.failed` carries `{ mcpName, url }`; the server could not open the MCP OAuth URL on its own. The app stores this as the chat `approvals.mcpAuth` alert (Open link / Dismiss) and also refreshes MCP status, so a mid-session tool that needs authentication is not silently blocked. The alert hides once the named server reports `connected`.

The V2 adapter maps refresh-relevant events onto the same V1-shaped handler: `lsp.updated`, `mcp.tools.changed` (in addition to status/resource changes), `worktree.failed`, `credential.switched` (catalog), `session.instructions.updated` / `session.metadata.updated` / `command.executed` (session), plus the V1-only `message.part.delta`, `project.directories.updated`, `file.watcher.updated`, `reference.updated`, `plugin.added`, `models-dev.refreshed`, and `integration.updated`.

On V2 a mid-turn provider failure emits `session.execution.failed` (mapped to `session.idle`) followed by `session.retry.scheduled` (mapped to a `session.status` carrying `retry`, `attempt`, and `next`). V2 keeps the retry on the assistant message, so the adapter also maps `assistant.retry` to a transcript `retry` part, and the running indicator shows the retry attempt from the session status. Because the running set excludes retries, a session-list refresh must not overwrite the event-derived retry: `mergeSessionStatuses` keeps it until the server reports the session running, a terminal event clears it, or the retry's `next` is more than two minutes stale. Preserving the retry keeps the session busy, so the safety poll keeps running and recovers output even when the retry's SSE frames are missed.

## Polling Fallback

A 5-second loop remains active while connected with an active project. Safety polling is used when SSE is not connected; busy sends, non-idle sessions, and conversation mode also drive refresh work.

Polling can refresh:

- session list and statuses
- current session messages, diff, and todos
- conversation session messages, diff, and todos when it differs from current
- pending permissions and questions
