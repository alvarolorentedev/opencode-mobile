# Phase D — Transcript

Status: **complete**. Scoped infinite queries and persistence passed
`validate:commit` with 1,280 tests and one existing skip, the web export, and
all 185 browser flows. Focused persistence and resilience tests passed.

## Browser performance

Five alternating pairs compared Phase C (`8d8186bd`) with per-session queries
and Query persistence. Each stream delivered 160 deltas at 10 ms intervals
after sending an 8 MiB inline attachment. The cold sample measured the first
visible transcript record after reload with the newest-page response held for
1.6 seconds. It selected the chat row directly because the app bar can show the
same text as the session title.

| Measurement | Phase C | Phase D |
|---|---:|---:|
| First visible delta | 55–58 ms | 57–58 ms |
| Visible updates to final delta | 30–31 | 31 |
| Median interval between updates | 60 ms | 59–61 ms |
| Per-run p95 lag from newest delta to its visible update | 20–22 ms | 20–22 ms |
| Cold transcript median | 168 ms | 174 ms |
| Cold transcript range | 165–201 ms | 167–219 ms |

All ten reloads painted before the held response. The five Phase D runs each
persisted one 6,465-byte Query envelope, one transcript tail page, no paging
cursor, no inline payload and no legacy transcript key. Every run captured two
newest-page reads during connection and turn reconciliation and one assistant
detail attempt. The fake server's detail endpoint returned 404, exercising
the existing fallback. Both builds transferred the same message-read bytes.
Device profiling remains separate.

Goal: canonical messages become per-session infinite queries. The live stream
overlay lives in Zustand. The connection-scoped message map is deleted.

Read the [phase index](README.md), [ADR 0050](../../adr/0050-live-v2-transcript-with-reconciliation.md),
and [chat behavior](../../product/functional-spec.md#chat-screen-detailed-behavior) first.

Start only after Phase C is complete and green.

## Phase C baseline

- A single connection-scoped Query held every canonical session window.
- `useTranscriptMetadata` reads Query-owned pagination cursors and ledgers;
  the app store holds the transcript request flags.
- `useLiveTranscript` renders the app-store overlay alongside canonical windows.
- `features/chat/model/live-transcript.ts` is the pure event reducer.
- `features/chat/services/transcript-cache.ts` is the bounded cold-start cache.

## Target shape

- `useInfiniteQuery` per session:
  - key includes connection, scope, auth revision, contract and session id;
  - pages are the existing window shape;
  - turn end writes the canonical message with `setQueryData`;
  - pagination uses the same cursor semantics as today.
- Live overlay in Zustand, keyed by scope/session:
  - `reduceLiveEvent` remains the only reducer;
  - the store holds the overlay result;
  - a page read cannot roll back a streamed turn.
- Retention:
  - `gcTime` 30–60 minutes for session/message keys;
  - normal retention for ephemeral resources;
  - bounded recent-session prefetch for tab/project continuity.
- Delete the connection-scoped message map and the custom transcript cache only
  after the new cold-start path is proven; never persist inline media.

## Steps

1. Spike the per-session infinite query with the live overlay. Measure the 50 ms
   paint throttle and one turn with a large inline attachment. Stop if it is
   slower than the current path.
2. Add the per-session query factory and selectors. Keep the existing window
   merge helpers where possible.
3. Move the live overlay to the store. Keep generation/tail counters only where
   Query cannot express them.
4. Move transcript pagination, hydration and usage/todo derivation off React
   state (Phase A5 should have prepared this).
5. Delete the message map. Find every `messagesBySession` write/read.
6. Verify cache and cold-start behavior. Drop the transcript cache only if the
   new query restores within the existing paint budget.

## Phase D gate

```bash
npm run validate:commit
EXPO_PUBLIC_E2E_MODE=1 EXPO_APP_VARIANT=development npm run build:web:ci
E2E_SKIP_BUILD=1 npx playwright test tests/e2e/chat.spec.mjs tests/e2e/diffs.spec.mjs tests/e2e/realtime.spec.mjs tests/e2e/network-resilience.spec.mjs
```

Full 185-flow suite required at this checkpoint.

## Acceptance

- No connection-scoped `messagesBySession` map.
- One query per session with stable pagination and turn-end reconciliation.
- Live overlay is store-owned; no authoritative React state/ref.
- Open, reconnect, foreground return, compaction/revert and attachment flows
  pass.
- No inline media in persisted caches.

## Pitfalls

- This is the only phase with a real performance risk. Do not skip the spike.
- A live delta must never be overwritten by an older page read.
- Do not refetch the whole page per stream event; that is the regression ADR 0050
  fixed.
- Keep the turn-end single-message reconcile, including the 404/405 fallback for
  older servers.
- Retained chats must still paint on tab/project switch.
