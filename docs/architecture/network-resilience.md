# Network Resilience

Related ADRs: [0004 SSE with polling fallback](../adr/0004-sse-with-polling-fallback.md), [0014 scoped server data and lifecycles](../adr/0014-server-data-and-explicit-lifecycles.md), [0050 live V2 transcript with boundary reconciliation](../adr/0050-live-v2-transcript-with-reconciliation.md)

The app targets real-world 4G as its normal remote-link floor and keeps 3G
usable in a degraded mode. It does not assume that "connected" means the radio
or the OpenCode server can answer right now. The design has four rules:

1. **Bound every request.** No read, write, probe, or stream handshake may wait
   forever.
2. **Recover immediately when the radio returns.** Connectivity is an
   acceleration signal, not proof that a particular server is reachable.
3. **Prefer stale content over an empty screen.** Server-derived caches paint
   first and revalidate behind the UI.
4. **Never replay an uncertain mutation.** Prompt admission, permission
   replies, question answers, and file writes reconcile before retry.

## Connectivity

`shared/network/use-network-status.ts` subscribes to NetInfo and normalizes it
through `shared/network/network-status.ts`:

- `online`: false only when the radio is disconnected or explicitly reports no
  internet.
- `type`: Wi-Fi, cellular, Ethernet, none, or other.
- `expensive`: cellular.
- `constrained`: 2G/3G when the radio exposes a generation. An unknown
  cellular generation is metered (`expensive`) but not assumed slow.
- `generation`: best-effort 2g/3g/4g/5g label.

NetInfo is configured with `reachabilityShouldRun: () => false`: the app never
makes an external captive-portal probe. A failed OpenCode request remains the
authority for a server-specific problem. Configuration is never read directly
by screens; the provider exposes it through diagnostics.

Offline pauses SSE retries and polling. Online cancels a pending reconnect
timer, reopens the stream, and runs a critical reconcile. Link-type changes do
not overwrite the selected connection or clear server-derived caches.

## Request policy

`shared/protocol/opencode/client/request-policy.ts` and `read-deadline.ts` define:

| Request | Deadline | Automatic retry |
|---|---|---|
| Probe (`/api/info`, `/api/health`, `/global/health`) | 5 s | one quick attempt in connect flow |
| GET/HEAD read | 30 s | one fast transport/502/503/504 retry |
| POST/PUT/PATCH/DELETE | 60 s | never |
| SSE (`/event`) | no total deadline | liveness watchdog |

The deadline covers body consumption, not just response headers. Caller abort
is classified as cancellation, not as a transient failure. A read that has
already spent most of its budget is not retried, because doubling a 3G wait is
worse than surfacing the failure.

`shared/network/request-stats.ts` keeps a bounded local ring buffer of durations,
failures, timeouts, retries, and the last status. Settings → Diagnostics shows
p50/p95 plus today's data usage. It stores no URLs, bodies, or credentials.

### Transport trust

Manual connections use system trust by default. A certificate imported on the
connection screen is an additive anchor scoped to that connection's `host:port`.
It applies to API reads, SSE, and the terminal WebSocket. Cloud Link, update
checks, and unrelated hosts keep normal system trust. OpenCode 1 connections
keep their existing system-trust behavior and never persist an imported
certificate.

The native module is `modules/opencode-tls/`: Android installs a host-aware
`SSLSocketFactory` and `X509ExtendedTrustManager` through the existing OkHttp
hooks; iOS installs a host-scoped `NSURLProtocol` and `SRSecurityPolicy`. Expo's
fetch configuration provider is registered synchronously on the main thread
before JavaScript requests begin, as its setter is main-actor isolated. A
certificate failure is a distinct, non-retryable connection failure with an
actionable message. See [ADR 0021](../adr/0021-per-connection-custom-ca.md).

### OpenID Connect authorization

A manual connection can instead authenticate with an OpenID Connect provider.
The connection form stores the issuer, client ID, scopes and an optional redirect
URI override; the redirect URI defaults to `opencodemobile://oidc-callback`
 and is shown so it can be registered with
the provider. Providers are limited to public clients using Authorization Code +
PKCE (S256). Only the registered app callback scheme is supported; HTTPS app links and Expo Go callbacks are not registered. See [ADR 0024](../adr/0024-oidc-pkce-connection-authorization.md).

- Sign-in uses `expo-auth-session` for PKCE, OAuth state and system-browser coordination (`expo-web-browser`), never the in-app WebView.
  The verifier and state stay in process memory; only the code returns.
  `app/+native-intent.ts` routes the callback back to the route that started
  sign-in, so the connection form survives the browser round trip.
- `shared/auth/oidc/discovery.ts` fetches `/.well-known/openid-configuration`
  and rejects a document whose `issuer` does not match the configured value. Issuer, authorization and token endpoints require HTTPS, except explicit HTTP loopback development endpoints (`localhost`, `127.0.0.1`, `[::1]`). Discovery and token requests use Expo fetch with redirect rejection.
- Tokens are refreshed 60 s before expiry and once after a 401/403.
  `shared/protocol/opencode/client/authorization.ts` resolves the bearer token
  immediately before each request, so no token is baked into a cached client.
  A replay after a refresh is limited to requests with no body or a string body.
- Only an `invalid_grant` response on HTTP 400/401 clears the session. Network failures, timeouts, 429, 5xx, malformed responses and provider configuration errors preserve stored credentials. The connection reports an auth failure
  and the connection screen offers `Sign in`/`Sign in again`; the app never opens
  a browser without a tap. `probeConnection` reports
  `openid-sign-in-required` so the setup form keeps its options instead of
  claiming the server is unreachable.
- The access and refresh tokens are AES-256-GCM encrypted with a key in
  SecureStore and the ciphertext in AsyncStorage, keyed by connection scope,
  issuer and client ID. The OIDC block itself is non-secret profile metadata.
- The terminal WebSocket upgrade uses the same bearer token through a
  non-interactive token snapshot that refreshes when the session table changes. OIDC sockets reject redirects; legacy sockets retain their existing policy.
- Web builds cannot intercept the redirect; sign-in reports an explicit
  unsupported error there.

OIDC API credentials are resolved only for the configured secure origin and proxy
mount. Redirects are rejected before forwarding credentials, including in the
nested iOS custom-CA session. Basic authorization remains app-owned; caller
headers cannot replace it. Connections without OIDC keep their existing HTTP,
Basic, gateway-header, custom-CA and Cloud Link behavior.

Refreshes are single-flight and coalesce by the access token actually rejected,
so an immediate 401 after sign-in renews rather than reusing that token. Session
generations reject stale browser/refresh results after sign-out, replacement or
profile removal; per-session storage operations are serialized. Each caller can
cancel its own wait without cancelling another caller's token rotation.

## Realtime and polling

`runtime/realtime/use-opencode-realtime.ts` keeps SSE primary and polling as a safety
net.

- A stream attempt has a first-byte/connect timeout (15 s).
- Reconnect backoff starts at 1 s and caps at 15 s, with jitter above the first
  attempt to avoid a cell-wide retry herd.
- The backoff resets only after the stream has been stable for 5 s, not on the
  first envelope.
- The watchdog checks every 5 s. It reconnects after 60 s without activity when
  idle, or 45 s while work or a blocking interaction is active. Keepalive frames
  reported through `onActivity` advance the same window, so a long silent tool
  call does not restart a healthy stream.
- Foregrounding still performs the authoritative reconcile and cycles a stream
  that was backgrounded for 15 s or more.
- Auth/entitlement failures stop retrying and surface recovery, as before.

Polling is state-driven:

| State | Cadence |
|---|---|
| SSE healthy + idle | none |
| SSE healthy + busy | 10 s (15 s constrained) |
| SSE degraded + busy/idle | 5 s (8 s constrained) |
| Offline | none |
| App background | none |
| Repeated failed passes | doubles up to 30 s |

Reconciliation is tiered. Session identity, pending interactions, and the
visible transcript start together. Diff/todo detail waits for the transcript,
and native surfaces/widgets run last. A reconnect pass is queued behind an
in-flight poll instead of being swallowed by it.

### Mission Control reconciliation

Mission Control observes the existing shared V2 stream per connection. Initial,
foreground and reconnect reads seed directory-scoped permissions and forms with
two directory reads in flight per connection. While Mission is visible, a
30-second fallback checks execution and approvals when work is active or SSE is
degraded. Dashboard reconciliation uses the bounded connection catalog and
does not request transcripts. Leaving Mission stops its fallback. Connection
and foreground gates cancel Mission reads and reject stale responses.

## Connect recovery

`runtime/connections/create-connection.ts` runs the connection probe and Cloud
Link renewal with a clock and foreground port. The connection adapter supplies
the latest settings and listens to the lifecycle snapshot. A prepared rotation
rekeys the in-flight attempt so reopening a panel cannot launch a second probe.

`features/connections/state/use-connection-retry.ts` retries retryable connect failures while
the workspace is visible and online:

- 1/2/5/10/20 s, bounded to five attempts;
- a 500 ms retry after an offline→online transition;
- auth, entitlement, and incompatible-server failures never auto-retry;
- the status banner shows the attempt and Settings → Diagnostics shows the
  reconnect state;
- a manual Connect or a successful connection resets the budget.

## Offline prompt queue

`features/chat/state/use-prompt-inbox.ts` keeps a process-lifetime queue.
See [ADR 0045](../adr/0045-queue-only-unsent-prompts.md).

- When the app detects that it is offline, it queues the input before making a
  request and shows `Queued — will send when connected`. Transport failures
  while preparing the agent, model, or instructions can also queue the prompt
  because its admission request has yet to start.
- Inputs stay scoped to their connection and project across client rebuilds.
  Reconnect attempts admission once per entry and can retry preparation.
  Dismissing an entry before its attempt starts removes it from the queue.
- A transport failure during prompt admission is marked `Delivery uncertain`.
  It stays visible until dismissed. An older message with the same text is
  insufficient to confirm delivery.
- The queue is in memory. Prepared attachments can be large or refer to
  temporary files, and the app does not send queued prompts after it relaunches.

## Cached read path

Bounded AsyncStorage snapshots are keyed by connection scope + project (and
session for transcripts):

- `features/chat/services/transcript-cache.ts`: newest 24 records, 200k-character cap, 7-day
  TTL. The cache keeps at most 64 session snapshots across connections, evicting
  expired entries and then the oldest entries before writing. Hydrates when a
  session opens before the live read, so a chat paints on a
  cold 3G start. Writes are debounced and capped so streaming bursts do not
  cause a storage write per page.
- `features/ai/services/capabilities-snapshot.ts`: last-known config, providers, models,
  agents, and auth methods, 300k-character cap and 7-day TTL. A cached model
  list keeps the composer usable while the first capability refresh is in
  flight. A fresh response always wins over a cache response that lands later.

Routine server reads use [scoped TanStack Query entries](state-and-data.md#routine-server-reads).
Background retained workspaces unsubscribe; stale active reads recover on foreground/online
return. Query owns no polling timer or automatic mutation replay.

Cloud Link credential rotation migrates all three connection-scoped snapshots
(session list, transcript, capabilities) to the rotated scope.

## Mutations

`features/sessions/state/use-session-interaction-actions.ts` treats a lost permission/question
response as uncertain:

- permission: re-list pending requests; if the request is gone, keep the card
  removed and refresh;
- question reply/reject: re-list; if the request is gone, treat it as applied;
- file saves: read the file back before reporting failure, so a committed write
  is not repeated.

Prompt delivery uses the queue/reconcile rule above.

## Live transcript

The visible V2 transcript is painted from stream events, not from page polls.
`features/chat/model/live-transcript.ts` maps text, reasoning, tool, step, retry
and usage events into parts; `features/chat/state/use-live-transcript.ts` keeps
them behind a 50 ms paint throttle and overlays them when a page read lands
mid-turn. A prompt this client admits is appended locally from the submitted
parts, so the user message and its attachment bytes are not fetched back.

Reconciliation is boundary-only: one `session.message.get` for the active
assistant message when the turn finishes, and a full newest-page read on session
open, reconnect, foreground return, compaction/revert, or an event the reducer
cannot place (synthetic, shell, skill rows). While SSE is connected the safety
poll refreshes status, interactions, diff and todos but never transcripts. Inbox
events read only the inbox. Events for background sessions are ignored.

The stream has no replay cursor, so a missed turn-end or reconnect always
performs the authoritative read. Stock servers store attachment bytes inline in
their messages; this design avoids re-reading those bytes on every event, but a
session open or reconnect still transfers them once. True deferred retrieval
requires the server's experimental media-blob mode.

## Attachments

`shared/protocol/opencode/attachment.ts` enforces the 10 MB per-file limit and re-encodes
local images larger than 1 MB to a 2048 px-wide JPEG before Base64 encoding.
Compression is best-effort; the original bytes remain valid if the native
manipulator is unavailable. This avoids turning a 10 MB camera image into a
13 MB JSON body on a cellular uplink. The transcript cache measures inline media
before serializing and drops an over-budget record instead of stringifying it.

## Terminal

Terminal transports reconnect when the radio returns, not only on foreground.
The existing jittered 1/2/4/8/15 s retry and cursor replay are unchanged.

## Validation

`tests/fake-opencode/server.mjs` exposes `/__control/network` with latency,
jitter, deterministic failure rate/status, hang, and SSE keepalive cadence.

`tests/e2e/network-resilience.spec.mjs` covers:

- congested 4G latency while a prompt completes;
- an offline prompt being queued and delivered exactly once after reconnect.

Unit coverage lives in `runtime/__tests__/network-resilience.test.ts` (normalization,
request policy, transcript cache), `feed.test.ts` (offline queue), and the
existing realtime/provider tests. Native behavior still requires physical-device
validation on real 4G, including Wi-Fi↔cellular handoff and a long idle stream.
