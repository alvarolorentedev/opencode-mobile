# Phase A — State Evacuation

Status: **complete**. A1–A7 passed their automated checks and the Phase A gate.

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
- Store-keyed hooks receive the workspace `scopeKey`. The original React
  adapter was removed during Phase E.
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
timer lifecycles.

### A4 — Terminal

The [terminal state](../../architecture/state-and-data.md#terminal-state) uses
Query for PTY inventory and the app store for the opened instances, selection
and renderer generation. The terminal connection service publishes status into
the workspace's store entry and keeps the transport handles and replay cursor.

### A5 — Transcript state and live overlay

The [transcript sources](../../architecture/state-and-data.md#session-content-caches)
are scope-keyed. Query owns pagination cursors and the accumulated usage and
plan ledgers. The app store owns request flags, the live overlay and optimistic
local admission. React presents the combined transcript with the existing
50 ms stream cadence. Phase D replaces the connection-wide canonical window
with per-session infinite queries and verifies the cold-start path.

### A6 — Extensions, MCP, projects and capabilities

Workspace device state covers extension requests, mutations and plugin
selection, MCP and diagnostics demand, file browser and preview selection, and
the current classifier probe. Query still owns server catalogs and now caches
classifier outcomes by project, credential generation and model.

### A7 — Delete the remaining per-workspace state

The workspace adapter reads diff preferences, selected sessions, active project
paths and connection settings directly from the app store. Session lists read
through to Query. The obsolete chat runtime state hook is deleted. Voice
confirmation and the readback queue use the conversation slice. Entry-operation
capability uses Query, and the file clipboard, feedback and inspection targets
use the app store.

The audit covers retained workspaces. Connection-level catalog publications and
route scope carriers remain for the connection and React flattening phases.
Screen editors and native speech setup retain local interaction state. Request
refs retain tokens, timers, audio handles and locks for in-flight work.

Audit commands:

```bash
grep -R "useState" features/*/state runtime/workspace
grep -R "useRef" features/*/state runtime/workspace
```

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
