# ADR 0004: SSE primary with polling fallback

- Status: Accepted
- Date: 2026-10-29
- Deciders: maintainers
- Supersedes: —
- Related: [Network resilience](../architecture/network-resilience.md), [Architecture overview](../architecture/overview.md)

## Context

The app runs on mobile networks where a connection can look healthy while a
stream is stalled, a radio transition can drop the transport, or a server can
stop emitting events without closing the socket. The UI must still reconcile
session status, pending permissions and questions, transcripts, and terminal
state. Trusting a single transport would leave the app silently stale.

## Decision

Use SSE as the primary realtime transport and polling as an explicit safety net.

- One global SSE subscription per server is fanned out to retained projects and
  filtered by directory.
- Reconnects use jittered exponential backoff from 1 second to 15 seconds, with
  a first-byte/connect timeout and a stable-stream reset.
- A watchdog reconnects after 45 seconds without activity while work or a
  blocking interaction is active, or 60 seconds while idle. Keepalive frames
  count as activity.
- Polling cadence is state-driven: none while healthy and idle, 10 seconds while
  healthy and busy (15 seconds constrained), 5 seconds while degraded
  (8 seconds constrained), and paused while offline or backgrounded.
- Foregrounding performs an authoritative reconcile and cycles a stream that was
  backgrounded for 15 seconds or more.
- Offline pauses SSE retries and polling; an online transition restarts the
  stream and runs a critical reconcile.
- An uncertain mutation is reconciled, never replayed blindly.

## Consequences

- The app recovers from stalled streams and radio transitions without requiring
  a user action.
- Realtime behavior is more complex than either transport alone, so the
  reconnect, watchdog, and polling rules must stay in one provider owner.
- Polling cost is bounded by session activity and network state.
- Tests must cover both the healthy SSE path and the degraded polling path.

## Alternatives considered

- **SSE only:** lowest latency, but no recovery when the stream stalls without
  closing.
- **Polling only:** simpler and predictable, but higher latency and more
  requests during active work.
- **Custom WebSocket protocol:** more control, but adds a server contract and
  does not remove the need for reconciliation.
- **Client-side timers without server reconciliation:** hides staleness instead
  of resolving it.

## Follow-up

- [x] Keep SSE and polling in the provider realtime hook.
- [x] Document request deadlines and reconnect rules.
- [ ] Keep the fake server's stream-disconnect and polling scenarios current.
