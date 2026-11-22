# Phase A — State Evacuation

Status: **in progress**. A1–A4 are complete. A5–A7 remain.

Goal: remove every piece of domain data from the per-workspace React runtime so
the runtime can be deleted in Phase E without losing retained state.

Read the [phase index](README.md) and [ADR 0051](../../adr/0051-app-core-state-tiers.md)
first. The rule is: server facts in Query, device facts in Zustand. Refs may
keep timers, sockets, promises and locks; they may not be the authority for data
that must survive a workspace or tab switch.

## What is already done (A1)

- Prompt sending state and prompt error are in the store (`runtime/core/store.ts`,
  prompt slice).
- Transcript read errors are in the store (`chat.readErrors`).
- `runtime/workspace/use-session-runtime-state.ts` exposes the workspace
  `scopeKey` for store-keyed hooks.
- The legacy `loadTs` helper has a default app-core stand-in so existing suites
  can exercise store-backed hooks until Phase F migrates them.

Commit: `refactor(chat): move prompt and transcript-error state into the app store`.

### A2 — Prompt inbox and notices

The [prompt inbox and outbox](../../architecture/state-and-data.md#session-content-caches)
have separate owners. Query owns confirmed inbox entries and notices, and the
app store owns local admission entries and offline inputs. Queue length is
derived from the outbox. The hook retains request revisions and the flush lock.
Cancellation invalidates reads that started before the server confirmed it.

### A3 — Conversation

The [conversation runtime state](../../architecture/state-and-data.md#conversation-state)
is scoped to its workspace in the app store. Input and readback callbacks read
the latest phases directly. The workspace retains the recognizer, audio and
timer lifecycles. The final Phase A audit covers the nested confirmation and
readback queues.

### A4 — Terminal

The [terminal state](../../architecture/state-and-data.md#terminal-state) uses
Query for PTY inventory and the app store for the opened instances, selection
and renderer generation. The terminal connection service publishes status into
the workspace's store entry and keeps the transport handles and replay cursor.

## Remaining work

### A5 — Transcript state and live overlay

Current:
- `features/chat/state/use-transcript-state.ts` owns `messageWindows`,
  `loadingOlderBySession`, `hydratingSessionIds`, `usageStepsBySession` and
  `todoRecordsBySession` in `useState`.
- `features/chat/state/use-live-transcript.ts` owns the live message overlay,
  local sends and local users in refs.

Target:
- Add a scope-keyed transcript slice for pagination windows, hydration flags,
  usage steps and todo records. These are derived server data; if a Query
  resource is a better owner, move it there instead of duplicating it.
- Move live overlay, local send times and local user records to the store.
- Keep paint timers, generation counters and in-flight read refs as refs.
- Keep `reduceLiveEvent` pure. The store holds the result, not a second reducer.

Acceptance:
- No transcript pagination/overlay data in `useState` or authoritative refs.
- Transcript-policy, live-transcript and prompt tests pass.
- Chat, diffs and realtime E2E pass.

### A6 — Extensions, MCP, projects and capabilities

Files:
- `features/extensions/state/use-extensions-state.ts`
- `features/extensions/state/use-mcp-state.ts`
- `features/projects/state/use-project-browser.ts`
- `features/projects/state/use-project-file-actions.ts`
- `features/ai/state/use-capabilities-actions.ts`

Target:
- Server catalogs go to Query; selection, busy, error, requested and probe
  status flags go to a scope-keyed store slice.
- Keep file handles, timers and request counters as refs.

Acceptance:
- No domain data in `useState` for these hooks.
- Settings, extensions, projects and chat E2E pass.

### A7 — Delete the remaining per-workspace state

- Delete `features/chat/state/use-chat-runtime-state.ts` when its last field
  moves.
- Remove any ref that only mirrors a store/Query value. A ref is allowed only
  for a timer, socket, promise, request id or lock.
- Audit:

```bash
grep -R "useState" features/*/state runtime/workspace
grep -R "useRef" features/*/state runtime/workspace
```

For each remaining hit, either move the data or add a one-line comment
explaining why it is ephemeral transport state.

## Phase A gate

```bash
npm run validate:commit
npm run impact -- features/chat/state/use-prompt-inbox.ts
EXPO_PUBLIC_E2E_MODE=1 EXPO_APP_VARIANT=development npm run build:web:ci
E2E_SKIP_BUILD=1 npx playwright test tests/e2e/chat.spec.mjs tests/e2e/interactions.spec.mjs tests/e2e/sessions.spec.mjs tests/e2e/terminal.spec.mjs tests/e2e/multi-server.spec.mjs
```

Then update the Phase A status in [the index](README.md) and commit.

## Pitfalls

- Do not create a second canonical inbox or terminal cache. Query owns server
  facts; the store owns local queues/selection.
- Store setters must be stable and scope-keyed. A hook must not write to a
  stale scope after a project switch.
- `loadTs` suites use the default core stand-in from Phase A1. New tests use
  native imports and a real store; do not add new `loadTs` usage.
- Keep timers and transports mounted where they are; moving their data does not
  mean moving their effects yet. Phase B owns connection effects.
