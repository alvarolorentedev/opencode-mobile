# Phase D — Transcript

Status: **not started**.

Goal: canonical messages become per-session infinite queries. The live stream
overlay lives in Zustand. The connection-scoped message map is deleted.

Read the [phase index](README.md), [ADR 0050](../../adr/0050-live-v2-transcript-with-reconciliation.md),
and [chat behavior](../../product/functional-spec.md#chat-screen-detailed-behavior) first.

Start only after Phase C is complete and green.

## Current shape

- `features/chat/state/use-message-catalog.ts` holds one connection-scoped
  Query map keyed by session.
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
