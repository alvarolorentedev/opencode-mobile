# ADR 0050: Live V2 transcript with boundary reconciliation

- Status: Accepted
- Date: 2026-11-21
- Deciders: maintainers
- Supersedes: —
- Related: [Network resilience](../architecture/network-resilience.md), [State and data](../architecture/state-and-data.md), [Architecture overview](../architecture/overview.md), [ADR 0004](0004-sse-with-polling-fallback.md), `features/chat/model/live-transcript.ts`, `features/chat/state/use-live-transcript.ts`

## Context

Every V2 part event used to schedule a newest-page `message.list` read. The
transcript was only ever server data; SSE was treated as an invalidation signal.
That is correct and cheap for text, but a sent attachment is stored inline in its
user message, so each coalesced read (every 400 ms while a turn streams) carried
the attachment bytes again. An 8 MB video became an 11 MB download several times
per second, and the safety poll added the same read every 10 s. The UI stalled,
session switching became unreliable, and the chat appeared not to update.

The stream already carries the complete assistant turn: text, reasoning and tool
input deltas with stable ordinals, tool call/progress/success/failed content,
step usage and changed files, retries, and the final text. Only the turn-end
reconcile needs the canonical message.

## Decision

For V2, the open transcript is painted from live stream events; reads reconcile
at boundaries instead of polling.

- `features/chat/model/live-transcript.ts` is the only reducer from stream
  events to transcript parts. It owns text/reasoning/tool/step/retry mapping and
  starts from the held record so an opened chat is extended, not replaced.
- `useLiveTranscript` applies events for the visible transcript only, throttles
  paints to one per 50 ms, and keeps a live overlay so a page read that was
  already in flight cannot roll a streamed turn back.
- A prompt this client admits is appended locally from the submitted parts, so
  the composer commit does not wait for or download the stored prompt.
- A finished turn reconciles with one `session.message.get` for the active
  assistant message. The newest page is read only for opens, recovery
  (reconnect, foreground), history rewrites (compaction/revert), or an event the
  reducer cannot place (synthetic, shell, skill rows).
- While the stream is connected, the safety poll refreshes status, interactions,
  diff and todos but never transcripts. The watchdog or reconnect performs the
  authoritative page read.
- Inbox transitions refresh only the inbox, never the transcript.
- Transcript cache writes measure inline media before serializing and drop an
  over-budget record instead of stringifying it.

V1 compatibility keeps its existing invalidation-and-refetch path. Trust applies
only to native V2 events.

## Consequences

- Streaming traffic is the deltas themselves; the sent prompt and its attachment
  bytes are fetched once at open or recovery, not per event.
- The chat stays responsive and switching sessions no longer competes with
  repeated multi-megabyte reads.
- The client now duplicates part assembly rules for live content. `text.ended`,
  `reasoning.ended`, `tool.success` and `tool.failed` carry full values, so a
  missed delta heals within the same turn; the turn-end read remains the final
  authority for usage, errors and server-side normalization.
- A missed turn-end event leaves the last streamed state until the next
  reconnect, foreground return or session open. That is the accepted trust
  boundary because the stream has no resume cursor.
- Live events for background sessions are ignored; their status row updates and
  opening the session performs the normal bounded read.

## Alternatives considered

- **Single-message refetch every 400 ms:** much smaller than a page, but still a
  request per token flush and no benefit over applying the delta.
- **Trust polling plus SSE without reconciliation:** risks silently stale
  transcripts after reconnects, which have no replay cursor.
- **Fetch the whole conversation on open and trust the stream:** multiplies
  inline attachment traffic by history length, slows first paint and adds a page
  loop; only the tail can change while a chat is open.
- **Server media references:** correct for bytes-on-demand, but they require a
  server flag users control. This decision must work with the stock V2 server.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add reducer, event-dispatch, targeted-read and cache-bound tests.
- [x] Link this ADR from the change summary.
