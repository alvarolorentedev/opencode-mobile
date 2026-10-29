# API Contract

Related ADR: [0003 V2-first protocol boundary](../adr/0003-v2-first-protocol-boundary.md)

## Primary Contract And Compatibility

OpenCode 2 is the primary contract, using the installed `@opencode/client` 2.0.16 SDK and its native `/api` operations. `ScopedOpencodeClient` exposes a typed subset as `api`, with explicit account, OAuth and inbox actions. Native responses, pagination cursors and events are consumed directly; no fabricated v1 response envelopes exist on this path.

OpenCode 1 uses `@opencode-ai/sdk/v2/client` only within `lib/opencode/compat/v1/`. The `compatibility` extension preserves legacy behavior and v1-only operations. Transcript entries, capability options, session summaries and diagnostics are app-owned presentation models, derived in protocol helpers/services/provider selectors. Screens and components do not parse SDK records.

`buildClient()`, initial provider state, uncertain detection and PTY URLs default to v2. Probing checks `/api/info`, `/api/health` and `/global/health` concurrently. Affirmative 1.x health or path responses win, including known `/api` compatibility routes. Setup distinguishes detected, authentication-required, unknown and unreachable results, with cancellation and five-second probe timeouts. Connection discovery attempts another contract only for missing endpoints (404/405) or malformed protocol responses. Authentication, rate-limit, server and transport failures never trigger alternate-contract attempts.

The existing connection scope, storage keys and persisted DTOs remain unchanged. Hydration restores cached summaries as app summaries rather than claiming they are complete SDK sessions.

### V2-only feature policy

New capabilities that require an API surface outside the existing V1 compatibility layer are implemented for OpenCode 2 only. Until this policy changes, do not add new V1 adapters, endpoint shims, fallbacks, or V1 fake-server handlers for these capabilities. The UI hides or disables them when the active contract is V1.

V1 remains supported for existing behavior and maintenance fixes. Current examples of V2-only capabilities include composer context mentions (`@`), session shell commands (`!`), skill/reference discovery, composer autocomplete suggestions, and the OpenCode auto-model classifier call. On-device auto-routing has no API dependency and can run on either contract.

### Local V2 pairing

Manual connections can also attach per-connection custom HTTP headers, for
example Cloudflare Access service tokens (`CF-Access-Client-Id`,
`CF-Access-Client-Secret`), Authelia/oauth2-proxy cookies, or corporate proxy
credentials. They are merged into every request built for that server: probing,
SDK REST and SSE subscriptions, terminal connect-token requests, and the native
terminal WebSocket upgrade. The generated Basic `Authorization` always wins, and
framing/transport headers cannot be overridden. Header values live in secure
storage with the password; see [persisted data](./state-and-data.md#persisted-data).
Custom headers are manual-only because pairing codes and Cloud Link profiles
cannot carry them.

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

## Native Client And Scoping

`lib/opencode/v2/raw.ts` constructs `OpenCode.make` with the authenticated, prefix-preserving transport. The SDK replaces URL path segments with absolute `/api` routes; a configured proxy prefix is rewritten by the shared fetch helper. A trailing `/api` is treated as the API mount, not duplicated. Blank usernames resolve to `opencode`.

Project requests carry `location: { directory }` where the native API supports it. Session/message operations use global session IDs; session listing uses the native `directory` filter and follows every cursor page, because a first page alone hides a project's older chats. The picker renders the projects opened on this device + connection; `project.list()` enriches them (id, canonical, name) and a server project the user never opened is not rendered. Opening records the directory locally; closing removes the local entry without touching the server. An active path that is not opened on this connection is kept only when `location.get` resolves it (a deep link or a worktree), so nested or stale paths fall back to the most recent opened project. Adding a project boots the requested directory with `location.get` — persisting the project in the serve instance — and selects the server-resolved location (the project root for nested input, the worktree directory for a worktree). A repository can have multiple checkout directories (sibling clones and worktrees) that share one project ID; `project.list()` reports only one canonical, so session opening validates a directory through the opened list or `location.get` instead of canonical-path equality. Filesystem/PTY operations and their WebSockets remain scoped to the selected directory.

SDK success responses retain their native shapes. Failed HTTP responses preserve status and server error details for actionable UI errors and mismatch classification. No-op mutation methods are not installed for unsupported features.

## Project And Sessions

- Project catalog: `location.get()` and `project.list()`; project views retain ID, canonical path, name, VCS and sandboxes. The picker's list is the connection-scoped opened projects (persisted on the device), and the server catalog only enriches them; `location.get` validates a path that is not opened. The worktree inventory is filtered against known project canonicals, because a repository with multiple checkouts can report its own project root as a worktree; those directories cannot be removed or reset through the server.
- Sessions: `session.list()` plus `session.active()`, create/get/update/remove/fork, model/agent selection, instructions and interrupt. Native session listing is cursor-paged, so the service follows `cursor.next` (bounded, deduplicated) until the project's chats are exhausted; reading only the first page silently hides every older chat. Native active sets omit retries, so the provider preserves event-derived retry state across refreshes.
- Fork uses native `before`; revert interrupts any active execution, waits for the server to settle with `session.wait()`, then stages with `session.revert.stage()` and clears with `clear()`. V1 abort releases its session lock synchronously, so no wait endpoint is needed there. Waiting prompt cancellation uses `session.inbox.cancel({ sessionID, inboxID })`; unavailable items are a server-side no-op.
- Messages: `message.list({ sessionID, limit: 200, order: 'desc' })` for the initial newest window, `message.list({ sessionID, limit: 20, order: 'desc' })` for tail reconcile, then opaque `cursor` without an `order` override for older 200-record pages. The native query validates `limit` as 1..200, so the adapter clamps larger requests. Native `cursor.next` is retained in the provider window. Loaded history is not capped; each explicit scroll-to-top issues one older batch. Each page is treated as a contiguous slice of durable order: unseen records are placed relative to their page anchors, and responses from a superseded window generation are ignored. Window rewrites bypass read coalescing so a pre-compaction/pre-revert page is not reused. Message order is durable sequence, never `time.created`.
- The V2 `message.list` endpoint accepts `type` as a **single** native record type (`user`, `assistant`, `idle`, `system`, `shell`, `skill`, `synthetic`, `compaction`, `agent-switched`, `model-switched`, `location-switched`), filtered before pagination and repeated with each cursor. The app does not filter the mixed timeline because it needs both user and assistant records; the selected timeline detail decides which activity rows render, without changing what is fetched or retained. Shell records map to a synthetic shell tool detail with command, output, and exit status.
- Turn diffs: `session.diff({ sessionID, from: userMessageID })`; working/branch views use scoped `vcs.diff({ mode: 'working' | 'branch' })`. Native assistant snapshot files provide review navigation and filename-only fallback details. The two contracts describe a turn diff differently: v2 serves `{ file, patch, additions, deletions, status }`, while v1 serves whole-file `{ file, before, after, … }` with no patch. `lib/opencode/diff.ts` normalizes both shapes at their boundaries and rebuilds a single-hunk patch when the server exposes contents but no patch, so a v1 turn diff renders its changed lines instead of a filename with an empty body.
- Usage and plans accumulate independently of the display window. Updates to the same assistant call replace its usage entry; replay cannot double-count. Todo writes update by message ID and stay chronological when older pages arrive. Plans derive from native `todowrite` input; v1 uses its server todo endpoint.
- Context utilization uses the most recent completed call's input, cache read/write and output, rather than cumulative session totals. Model prices are converted from native USD per million tokens to the app's per-token pricing model, preserving tiers.

## Prompts, Instructions And Inbox

Native prompts use `session.prompt({ sessionID, text, files, agents, skills, delivery })`. Composer context resolves selected `@` tokens into the native `files`, `agents`, and `skills` arrays with `{ start, end, text }` mention ranges; files are server paths, not uploaded attachment bytes. File mentions are omitted from the rendered attachment tiles because their text already carries the context. Before submission, services apply the selected agent/model with native operations and synchronize the `opencode-mobile.chat-preferences` instruction entry. Empty preferences remove that entry. Missing experimental instruction endpoints preserve the existing prompt fallback.

The native admission record identifies the accepted input. Completion is observed through events and message reads. `delivery` supports steer at a step boundary and queue/append at a later turn. Native inbox list/update/cancel operations preserve message identity, attachment bytes and pending state. V1 retains `session.promptAsync` with text/file parts and its `system` field.

Attachment capability checks, 10 MB local-file limits, temporary-file cleanup and URI/base64 preparation remain app-owned. File-only messages retain attachment details. Commands use native `session.command({ name, text })` after model/agent selection; v1 receives its legacy command/arguments fields. A leading `!` uses `session.shell({ sessionID, command })` and renders the native `shell` timeline record as the existing shell activity row when the selected timeline detail includes tools. Abort uses native `session.interrupt`; title summarization is v1-only.

## Auto Model Classifier

Auto model routing can use the V2 experimental classifier endpoint:

```text
POST /api/experimental/generate
{ prompt, model: { id, providerID, variant? } }
→ { data: { text } }
```

The app sends a constrained routing prompt and accepts only `simple`,
`standard`, or `complex`. The endpoint is V2-only and experimental, so the
OpenCode classifier option is gated by a probe. `404`/`405` marks the endpoint
unsupported; `401`/`403` marks authentication required; transport and `503`
failures remain retryable. A send-time failure leaves the prompt on the normal
default model. No V1 adapter is added. On-device routing uses the pinned GGUF
pack through `llama.rn` and is separate from this endpoint.

## Capabilities And Provider Authentication

Native discovery combines config documents, providers, models, agents and integrations. Integration catalogs keep unconnected providers addable while excluding MCP integrations. `activation: auto` is catalog policy, not proof of a connected account. Connection state derives from credentials/environment connections or enabled models. Provider models retain native IDs, including distinct variants sharing a modelID. Model reasoning support derives from compatibility and variant settings.

Native integration methods expose key/OAuth authentication and optional rich forms. The app prompt model preserves string/select/number/integer/boolean/multiselect/external fields, defaults and conditions. Environment/command methods never masquerade as key entry. Shared Console integrations may serve OAuth while the provider's direct integration accepts its API key.

`integration.connect.key`, `integration.oauth.connect/complete/status/cancel` and credential activate/remove operations own authentication. OAuth start carries automatic or code mode; automatic completion polls the server's pending/complete/failed/expired attempt state, with a fifteen-minute timeout. Cancellation invalidates in-flight reads and cancels attempts that arrive late. Connection changes reject stale results.

The installed SDK exposes credential mutations but not credential listing. Account discovery therefore reads authenticated `GET /api/credential` through the same transport; 404/405 means no account-list surface. Account views associate labeled credentials with each provider's serving integrations. Native `config.update` only patches the global `shell` field, so provider changes still use integration operations and a capability refresh; connecting a provider refreshes actual server state.

## Extensions And Config Files

Extension management is V2-only. `config.get` supplies the project and user-global config documents and discovery directories. The app reads raw JSONC with `file.read` for project files and a fixed, path-escaped `cat` shell read for global files, applies minimal JSONC edits, and writes through `file.write`. Project config reads append a per-request cache-busting parameter so a cached pre-create 404 cannot be revalidated as a `304` against the renamed temp file's older mtime. Durable MCP/plugin/command changes therefore live in the selected `opencode.json(c)` rather than the runtime-only MCP add/remove endpoints.

Every config mutation is transactional: backup, same-directory temp file, byte verification, re-read/concurrent-change check, atomic rename, and a `config.get` poll for the expected key. A failed replace or reload restores the backup. System/MDM config, symlinks, ambiguous global roots, missing shell support, Windows servers, and unreadable/invalid files are read-only. Removed skills move to a hidden `.opencode-mobile-trash` directory. No config validation endpoint exists in V2; validation is local JSONC/shape checking plus the post-write server reload check, and diagnostics that only appear in server logs are not available to the client.

## Approvals And Forms

Native permission requests use `permission.request.list`, preserving session ID, action/resources/save, metadata and tool source. Replies use `permission.reply({ sessionID, requestID, decision })`. Saved always-allow rules use `permission.saved.list/remove`.

Native forms use `form.list` and `session.form.reply/cancel`. The app question view preserves native keys, option values, conditional fields, custom answers, defaults and typed values; reply helpers convert UI answers into native `FormAnswer` values. Successful replies remove cached requests; failures retain answers for retry. Nested-session approvals retain provenance in the active chat. Activity completion requires both permission and form reads to succeed.

## File Editing And Worktrees

Native filesystem APIs support find/list/read, with text decoding that rejects binary and malformed UTF-8. `file.read` returns raw bytes, which the project browser retains for raster-image, audio and video previews (bounded at 25 MB) and never stores as text. `file.write({ location, path, payload: Uint8Array })` saves text bytes. Downloads use the authenticated V2 `/api/fs/read/<path>?location[directory]=...` route so large archives and installers stream instead of loading into JS memory; headers carry the connection's Basic auth and gateway headers. The V1 `/file/content` response has no binary bytes, so V1 binary preview/download is unavailable. Provider actions validate paths, compare current server content with the editor baseline, reject known conflicts, write and verify the exact saved text. Failure retains the editor draft and original baseline. Successful saves refresh file/VCS state; stale responses cannot replace a different connection or selected file.

The pre-read cannot prevent a concurrent edit between comparison and write: native v2 has no atomic conditional-write API. V1 retains conflict-checked VCS patch application.

Native worktree list/create/remove uses the owning project ID, while the selected location remains the worktree directory. Reset is v1-only.

## MCP Authentication And Runtime Lifecycle

Native MCP list/add/connect/disconnect operations use the selected location. Runtime additions remain runtime-only; the Extensions surface writes durable MCP entries to the selected project or user-global config and keeps connect/disconnect/OAuth as runtime controls. Persistent enable/disable is not exposed in the extension editor yet.

OAuth resolves each MCP server's exposed `integrationID`, then reads that integration's methods and invokes native OAuth connect/complete/status/cancel. The relationship is defined by the [upstream MCP implementation](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/mcp/index.ts); it is never inferred from a server name.

The provider exposes grouped `mcpOAuth.methods/start/complete/wait/cancel` actions carrying the authorization mode. Settings reuses the provider authentication form dialog, supports automatic completion/code entry, cancels on dismissal or connection changes, and guards late results. Native OAuth controls appear only when the server exposes an integration ID. V1 retains remote MCP authorization URLs and code callbacks, plus its browser-open-failure alert.

## Terminals And Diagnostics

Native PTY list/create/update/remove and `pty.connect.token` use the project location. WebSocket URLs default to `/api/pty/:id/connect`, preserving ticket, cursor and `location[directory]`; v1 uses its legacy route and directory query. Browser/native socket handling, reconnection cursor resume, output buffering and input state remain shared.

Native diagnostics load server.info and MCP status. LSP and formatter diagnostics are not part of the supported V1∩V2 surface.

## Realtime And Polling

Native events are dispatched directly. Execution/legacy-native status events maintain busy/idle/retry state; message/text/reasoning/tool/inbox events schedule transcript reads; compaction/revert reconciles full windows. Capability, project, filesystem/VCS, worktree, MCP and PTY events refresh their provider-owned domains.

V1 translates events with matching semantics at `compat/v1/events.ts`. Legacy message deltas, question metadata, configuration and diagnostic events retain explicit compatibility extensions. The native path never converts events to v1.

SSE reconnects with bounded backoff and reconciles sessions, pending interactions and active transcript state after recovery. Polling continues when SSE is unavailable and while busy even with a connected stream, so missed events cannot strand a prompt. Retry state keeps safety polling alive until execution resumes or completes. Completion notifications, review selections and conversation mode use provider-derived state on both contracts.

## Connector Service Management (Cloud Link)

A paired device manages the connector's exposed services directly over the tunnel, on the `server_url` origin (never a service port), using the same HTTP Basic credential as OpenCode traffic (`username = device_id`, `password = device_secret`). The control plane is not involved.

- `GET /_cloudlink/services` → `{ services: [Service, ...] }`
- `PUT /_cloudlink/services/{id}` → `201` created / `200` replaced, body is the bare `Service` (`port` and `target` required on management revision 2), response `{ service: Service }` with stored canonical values
- `DELETE /_cloudlink/services/{id}` → `204`
- `GET /_cloudlink/version` → `{ version, api, service_ports }`; every authenticated `/_cloudlink` reply also stamps the connector version in `x-cloudlink-connector-version`

On management revision 2 (connector 0.1.14+) `Service` is `{ id, name, port, path: string | null, target, enabled, access: 'private' | 'public', strip_prefix }`. A service with no `path` owns its port root, so apps that emit absolute URLs, cookies, redirects and WebSockets work untouched; services with a `path` share a port and keep prefix stripping plus path-absolute redirect re-prefixing. `port` must be one of `service_ports`; a root service needs a fully free port, a path service may share only a root-free port, `port`/`path` pairs are unique, and at most 16 services exist. Omitted PUT fields default to `name = id`, `path = null`, `enabled = false`, `access = 'private'`, `strip_prefix = true`. Links are `https://<host>:<port>/` for root services and `https://<host>:<port><path>/` for path services.

Management revision 1 and pre-version connectors keep the legacy path-only surface on `:8443`: listed services carry an implicit `port`, links stay `https://<host>:8443<path>/`, and the PUT body omits `port`. A `404` on the version endpoint without the version header means an unknown older connector: the app warns and stays in legacy mode. Root services and the port picker require revision 2 and otherwise show a non-blocking update hint. Errors are `400` invalid, `401` unauthorized, `404` unknown id, `405` method, `413` too large, `415` wrong content type; the app shows the connector's message and never branches on its wording. The list reflects connector-side (tray/CLI) edits, so the Settings surface re-fetches on open.

Client code and the validation mirror live in `lib/opencode/client/management.ts`; the provider exposes it through the connection domain (`useConnection().services`). The provider resolves the target machine from the active Cloud Link connection or a saved Cloud Link profile, so management keeps working while another connection is active and links use the target machine's own origin. See the connector's frozen `protocol/README.md` → "Service management API (device-authenticated)".

## Compatibility-only Features And Validation

Sharing, archive/restore, title summarization, general config writes, persistent MCP enablement, worktree reset, and LSP/formatter diagnostics are not supported on V1 because they have no V2 equivalent.

The default fake server and Playwright backend are native v2. Canonical native fixtures are translated/extended at the v1 fake boundary; filesystem and terminal infrastructure is version-neutral. Static architecture checks prohibit production v1 SDK imports outside compatibility. All three gates are required: `test:ci:static`, `test:fake-server:self`, `test:e2e:web`. Android development and real-server/device acceptance cover editing, OAuth, reconnects and terminals. Changed fake-server/E2E contracts require explicit human validation under AGENTS.md.
