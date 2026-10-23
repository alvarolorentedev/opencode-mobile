# Network Resilience

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

`providers/use-network-status.ts` subscribes to NetInfo and normalizes it
through `lib/network-status.ts`:

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

`lib/opencode/client/request-policy.ts` and `read-deadline.ts` define:

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

`lib/opencode/request-stats.ts` keeps a bounded local ring buffer of durations,
failures, timeouts, retries, and the last status. Settings → Diagnostics shows
p50/p95 plus today's data usage. It stores no URLs, bodies, or credentials.

## Realtime and polling

`providers/use-opencode-realtime.ts` keeps SSE primary and polling as a safety
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

## Connect recovery

`providers/use-connection-retry.ts` retries retryable connect failures while
the workspace is visible and online:

- 1/2/5/10/20 s, bounded to five attempts;
- a 500 ms retry after an offline→online transition;
- auth, entitlement, and incompatible-server failures never auto-retry;
- the status banner shows the attempt and Settings → Diagnostics shows the
  reconnect state;
- a manual Connect or a successful connection resets the budget.

## Offline prompt queue

`providers/use-prompt-inbox.ts` keeps a process-lifetime queue:

- A submission that fails with an offline/transport-level error stays visible
  with `Queued — will send when connected`.
- A timeout with an unknown server outcome is marked `Delivery uncertain`.
  It is never auto-replayed.
- Flush first reads the server inbox and newest transcript. If either already
  contains the prompt, the local entry is cleared without sending. Otherwise it
  admits once.
- The queue retries every 3 s while connected and online, and immediately on an
  online transition.
- Dismissing a queued/uncertain entry never calls the server with a local ID.
- Attachments are already prepared before admission; the queue is intentionally
  not persisted because data URLs can be large and may reference temporary
  files. The composer draft remains the durable copy across a relaunch.

This covers drops during a turn. It is not a background outbox: the app does not
send a queued prompt after being killed.

## Cached read path

Two bounded AsyncStorage caches are keyed by connection scope + project (and
session for transcripts):

- `providers/transcript-cache.ts`: newest 24 records, 200k-character cap, 7-day
  TTL. Hydrates when a session opens before the live read, so a chat paints on a
  cold 3G start. Writes are debounced and capped so streaming bursts do not
  cause a storage write per page.
- `providers/capabilities-cache.ts`: last-known config, providers, models,
  agents, and auth methods, 300k-character cap and 7-day TTL. A cached model
  list keeps the composer usable while the first capability refresh is in
  flight. A fresh response always wins over a cache response that lands later.

Cloud Link credential rotation migrates all three connection-scoped caches
(session list, transcript, capabilities) to the rotated scope.

## Mutations

`providers/use-session-interaction-actions.ts` treats a lost permission/question
response as uncertain:

- permission: re-list pending requests; if the request is gone, keep the card
  removed and refresh;
- question reply/reject: re-list; if the request is gone, treat it as applied;
- file saves: read the file back before reporting failure, so a committed write
  is not repeated.

Prompt delivery uses the queue/reconcile rule above.

## Attachments

`lib/opencode/attachment.ts` enforces the 10 MB per-file limit and re-encodes
local images larger than 1 MB to a 2048 px-wide JPEG before Base64 encoding.
Compression is best-effort; the original bytes remain valid if the native
manipulator is unavailable. This avoids turning a 10 MB camera image into a
13 MB JSON body on a cellular uplink.

## Terminal

Terminal transports reconnect when the radio returns, not only on foreground.
The existing jittered 1/2/4/8/15 s retry and cursor replay are unchanged.

## Validation

`tests/fake-opencode/server.mjs` exposes `/__control/network` with latency,
jitter, deterministic failure rate/status, hang, and SSE keepalive cadence.

`tests/e2e/network-resilience.spec.mjs` covers:

- congested 4G latency while a prompt completes;
- an offline prompt being queued and delivered exactly once after reconnect.

Unit coverage lives in `tests/vitest/network-resilience.test.ts` (normalization,
request policy, transcript cache), `feed.test.ts` (offline queue), and the
existing realtime/provider tests. Native behavior still requires physical-device
validation on real 4G, including Wi-Fi↔cellular handoff and a long idle stream.
