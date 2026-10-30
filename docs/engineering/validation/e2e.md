# E2E Flow Coverage

Playwright flows run against the fake server and encode the supported user
contract. They are intentionally flow-level, not component snapshots.

Back to the [validation index](../testing-and-validation.md) · [engineering index](../README.md).

## Determinism rules

- Reset the worker fake server before every test. The shared fixture does this
  automatically; a test must not depend on state left by a previous flow.
- Wait for an explicit readiness signal: a prompt admission response, a server
  status transition, a visible message, or a named request. Do not use a sleep
  to guess that work finished.
- Install fake clocks once and compute pause targets from a fixed base. Never
  read `Date.now()` in the page after installing the clock and then pause at a
  value derived from that read.
- Assert DOM order or stable state, not viewport coordinates measured across an
  auto-scroll or layout pass. If geometry is the contract, poll until two
  consecutive measurements agree.
- Keep retries at zero. Do not raise a timeout to hide a race; fix the missing
  readiness signal or the fake-server isolation.
- Spawn custom servers inside `try/finally` and use the isolated port wrapper
  for concurrent local runs.
- On failure, open the uploaded HTML report or trace, then reproduce with the
  single spec and title. The GitHub annotation names the failing test; the
  `test-results/` artifact contains the trace and screenshots, and the fixture
  attaches page errors and the fake-server state when available.

Known harness signatures:

| Error | First place to look |
| --- | --- |
| `clock.pauseAt: Cannot fast-forward to the past` | fake-clock target calculation |
| `E2E worker index ... outside the configured worker count` | worker-to-server mapping |
| `apiRequestContext ... socket hang up` | fake-server lifecycle/keep-alive |
| `expect(...).toBeLessThanOrEqual` on bounding boxes | scroll/layout timing, not styling |

A `pageerror` or an application error toast in the trace is an app regression;
a clock/port/worker error is test infrastructure.

## Spec map

| Area | Spec |
| --- | --- |
| App updates | `tests/e2e/app-updates.spec.mjs` |
| Auto model routing | `tests/e2e/auto-model.spec.mjs` |
| Chat, composer, transcript | `tests/e2e/chat.spec.mjs` |
| V1 compatibility | `tests/e2e/compat.spec.mjs` |
| Cloud Link / pairing | `tests/e2e/connect.spec.mjs` |
| Diffs and changed files | `tests/e2e/diffs.spec.mjs` |
| Extensions | `tests/e2e/extensions.spec.mjs` |
| Blocking interactions | `tests/e2e/interactions.spec.mjs` |
| Manual connections | `tests/e2e/manual-connection.spec.mjs` |
| Multi-server | `tests/e2e/multi-server.spec.mjs` |
| Network resilience | `tests/e2e/network-resilience.spec.mjs` |
| Onboarding | `tests/e2e/onboarding.spec.mjs` |
| Projects and worktrees | `tests/e2e/projects.spec.mjs` |
| Realtime and polling | `tests/e2e/realtime.spec.mjs` |
| Sessions and favorites | `tests/e2e/sessions.spec.mjs` |
| Settings | `tests/e2e/settings.spec.mjs` |
| Sharing | `tests/e2e/share.spec.mjs` |
| Terminal | `tests/e2e/terminal.spec.mjs` |
| V2 protocol | `tests/e2e/v2.spec.mjs` |

The Playwright flow specs (`tests/e2e/*.spec.mjs`) encode these supported-contract flows:

### Boot And Ready Chat

- load app
- if needed, switch to Project and select the fake project
- return to Chat
- confirm empty-state prompt and input are visible

### Main Happy Path Chat Flow

- send a prompt
- wait for finished assistant text
- verify the resulting chat appears in the Projects tab
- verify a deterministic assistant response renders a horizontally scrollable aligned GFM table, an ordered list, a tappable link, and subtly shaded monospace inline code

### Permission Blocking Flow

- send a prompt that triggers a permission request
- approve it
- verify run completion

### Question Blocking Flow

- send a prompt that triggers an assistant question
- choose and submit an answer
- verify run completion

### Provider Setup Flow

- open Settings
- add OpenRouter from the fake provider list
- enter an API key
- save configuration
- verify provider appears as configured

V2 regression coverage also connects OpenCode Go and OpenRouter from an `auto`
catalog using API keys, checks their model lists, and reloads to verify server
credential discovery. The fake V2 catalog includes environment and key methods
so environment methods cannot masquerade as a key form. The fake V2 server also
emulates labeled credentials (`/api/credential` list/create/activate/remove); an
E2E flow verifies a provider's accounts are listed and the active account can be
switched and removed. The Vitest suite (`test:vitest`) exercises the real
adapter's discovery, key submission, OAuth method indices, and V2 form-to-prompt
mapping. A V1 flow verifies manual key entry remains available alongside OAuth
metadata through the login-method dropdown. These fake-server and E2E changes
require explicit human validation under AGENTS.md, including adding a provider
against a real V2 server and real code/automatic OAuth completion.

### Connection API Base Flow

- point at a fake server with a configured API base path and verify the root-URL failure message suggests the prefixed URL
- reconnect through the prefixed URL and verify the connection succeeds
- point at a URL that already ends in `/api` and verify the message does not suggest a duplicated `/api`

### Primary OpenCode 2 Flows

- point at the V2 fake server and verify contract detection connects
- verify capabilities, session bootstrap, prompt completion, and transcript rendering work through the native V2 client
- verify context utilization resolves the session model's limit and renders the latest model call's tokens (`2.3K of 128K input tokens`) instead of "Unavailable"
- verify the derived plan renders (`Plan`, `2 of 2 tasks completed`) from the transcript's `todowrite` tool part, since V2 has no todo endpoint
- verify permission requests and form-backed questions unblock the flow
- verify form option labels are translated back to option values on reply (the fake server records the decoded answer)
- verify the V2 adapter scopes `GET /api/form` and `GET /api/permission/request` with `location[directory]`; the fake server rejects unscoped list calls
- verify the PTY WebSocket streams input/output under `/api`
- verify unsupported actions are hidden rather than failing: no share/archive actions or archived toggle; auto-approve is available on V2 and diagnostics show health/MCP only

### SSE Failure / Polling Fallback Flow

- run a prompt when the fake event stream is unavailable
- switch to Project
- verify the session still completes and becomes idle

### Connected SSE Safety And Reconnect Recovery

- drop domain events while keeping SSE connected; a submitted task still finishes
  through the busy-work safety poll
- a V2 provider error keeps its event-derived retry status across the session-list
  refresh, shows the retry attempt, and recovers the retried output through the
  busy safety poll after the post-send refresh window
- create a blocking question while suppressing events, then disconnect without
  resetting state; reconnect discovers the missed session/question for both protocols
- recovery flows spawn fresh servers to avoid reusing an older local fake backend
- both fake servers expose `POST /__control/event-stream` with `suppress` and
  `disconnect` for deterministic transport control; these controls do not change
  production endpoints

### Slow Network / 4G

`POST /__control/network` on the V2 fake server injects `latencyMs`, `jitterMs`,
`failRate`, `status`, `hang`, and `sseKeepaliveMs`. The profile resets with the
rest of `/__control/reset` and is reported by `/__control/network` and
`/__control/state`.

- congested-4G latency still completes a prompt (120 ms + 30 ms jitter)
- an offline prompt is shown as queued, then admitted exactly once after
  connectivity returns; the fake server asserts only one user record exists
- protocol-level request policy, network normalization, and the transcript
  cache are covered in `tests/vitest/network-resilience.test.ts`
- the offline/uncertain prompt queue is covered in `tests/vitest/feed.test.ts`

the Vitest `session-reads` suite exercises 4,300-record histories in both protocols,
newest-page (20-record) retrieval, backward cursor paging, shared message/diff
reads, rewrite reads that bypass coalescing, V2 shared listing/status, and
failure retry/client isolation.
the Vitest `record-preservation` suite covers the bounded-window merge: unchanged record and
array references are preserved, changed records are replaced, unseen records are
inserted relative to their page anchors, a stale page fills gaps without rolling
content back, and scrolled-up history is prepended without duplicates.
the Vitest `transcript-policy` suite covers the refresh modes: a cold load issues
one 200-record newest-window read, tail reconcile issues one 20-record read and
keeps held history, a late tail that still holds the initial prompt inserts it
above the assistant reply, responses from before a window rewrite are discarded,
a missing paging window is repaired with one read before the next scroll pages
back, scroll-up loads history older than the initial window and reaches the first
record, a non-overlapping burst adopts the fetched page without backfilling, and
only `replace` discards held history. `optimistic-flows` also covers the cached
selection that must still issue its background transcript read.
the Vitest `transcript-visibility` suite covers display eligibility across
user, assistant, tool-only, reasoning-only and patch-only entries plus hidden
file-mutating tools; `transcript-rows` covers all three timeline detail levels,
cross-entry activity grouping, read grouping, patch deduplication, bubble breaks,
hidden-tool counts, resolved file tools and reasoning groups; `activity-group`
covers collapsed defaults for running and settled runs, manual-toggle
persistence, recycled-cell state reset, session-running progress on the newest
completed group, header
type lists, expandable markdown, expandable diff cards, copyable shell code,
read rows, grep rows, and empty rows.
`test:provider-runtime` runs actual provider callbacks and extracted hooks with
deterministic platform/timer boundaries: out-of-order project results, stale
same-directory server responses, safety-poll overlap, reconnect snapshots,
subscription cleanup, a single voice submission through message updates, and
serialized profile saves with credential rollback and callback stability.
`test:persistence-hydration` checks field validation, credential-independent
hydration, ordered/deduplicated writes, and preserving unread records.
`test:notifications-background` covers concurrent changes, transient reads/writes,
malformed data, a re-sent task during background completion checks, and
outcome-aware copy (a server-reported failure notifies with the failure text while
a running task keeps its record).
The Vitest activity-notifications suite exercises the real provider observer,
aggregation service, and selectors with native/network boundaries mocked. It
covers multiple projects, descendants, blockers, retry/queue states, failed
reads, foreground permission changes, background polling, completion cleanup,
dismissal cycle keys, and stale reads after connection changes. V2 status tests
reject network failures and missing active-session responses instead of idle.
`tests/vitest/session-settlement.test.ts` pins the pure settlement decision table
(running, retrying, blocked, finished, failed, aborted) and
`tests/vitest/notification-route.test.ts` pins the non-secret route payload.
Provider-runtime also covers connection-scoped notification links.

Native acceptance remains required for activity notifications: start work, leave
the app and lock the device, confirm action updates, resolve a blocker, and check
the silent final result. Repeat with several desktop tasks, disabled notification
permission, disabled promotion, Stop monitoring, shade dismissal, network loss,
removing Recents, and a shortened Android foreground-service timeout. Confirm a
new task can show after dismissal and that no idle polling service remains.
Additional local-notification checks: tap a finished and a failed completion and
confirm the app opens the owning connection, project, and session; background
the app during a permission prompt and confirm one needs-input alert that does not
repeat on the next poll and re-arms after resolving; send a prompt then switch
projects before it finishes and confirm the completion still arrives (on return
or via the background task); force-stop mid-task and relaunch to confirm no false
"finished" alert fires from a cached idle status.
Check Android 16+ promotion and a pre-16 normal notification fallback; verify
production and FOSS clean prebuilds preserve the module and release shrinking
preserves Expo records. Web E2E cannot establish status-bar or battery behavior.
iOS device validation must confirm that a completion discovered while suspended is
delivered only when the app next runs or the background task is granted time.
the Vitest `record-preservation` suite is now part of the static CI gate.

### Project Mutation And Management Flows

- edit a text file and save it through the conflict-checked VCS patch path
- create an experimental worktree and add a remote MCP server

### Terminal Flow

- create a PTY from the fourth tab
- connect with a server-issued ticket over WebSocket
- send individual keystrokes before Enter; verify shell echo and completed commands
- exercise history, Ctrl+C, F12, alternate-screen return, resize, tab continuity, and cursor-based reconnect for both contracts

### Favorites And Saved Connection Flows

- favorite sessions in the current and other projects, then reopen them
- report a favorite session that no longer exists on the server
- settle rapid favorite taps on the last target
- save two connections that point at separate fake servers exposing the same
  project paths, switch between them, and verify each connection shows only its
  own sessions and restores its own model selection (the session cache,
  remembered session, and model preferences can never leak across servers)

### Cross-Project Active Sessions

- list a recently used session from another project in the Chat Library
  "Active across projects" group and switch to its project on tap
- list a session that is still running (busy) in another project
- the group is connection-wide, capped at four, and listed sessions are removed
  from the Chat list below (covered by the flow assertions and `test:active-sessions`)
- `test:active-sessions` unit-tests the selection: running-first ordering, recent
  tail, the four-item cap, and archived/subagent filtering

### Onboarding Flows

`tests/e2e/onboarding.spec.mjs` deliberately omits the `opencode-mobile.onboarding-version`
seed used by the flow specs, so the assistant is exercised:

- fresh install shows an informational presentation with only Continue, walks permissions → connect → AI → project → General → ready with connected step numbers 1–7 (five visible steps before connecting), checks back navigation and the expanded setup summary, enters chat, and does not reappear on relaunch
- every configured step can be skipped; skipping connection omits AI/project and the connection-dependent General fields and finishing without a project lands on the chat project prompt
- a failed connection keeps the entered values and allows a retry
- an installation with a stored settings key but no onboarding marker skips onboarding (upgrade migration)
- clearing `localStorage` shows onboarding again
- Advanced groups Editor and General controls; General → Reset onboarding restarts at the presentation, then reviews permissions, the prefilled connection, providers, project and general preferences before returning to a working chat without wiping configuration

Existing-install fixtures seed storage before application scripts run, avoiding
a race with hydration and the initial onboarding-marker write. A tab-scoped
`sessionStorage` flag keeps that seed from running again after `localStorage`
is cleared, so the clearing-data flow verifies a real fresh-install reload.

Provider permission prompts (notifications, microphone) cannot be exercised on
web because the platform APIs are unavailable there; the suite covers the
optional/skippable UI instead. Native permission behavior still needs device
validation. The voice check surfaces the same status on device, so a physical
iOS run should cover: enable/deny permission, the Settings deep link after a
denial, on-device -> network fallback when Siri/Dictation is off, and the
playback test against a stale saved voice.

The `test:voice-errors` static suite pins the pure recovery classification
(retry vs open-settings vs no action) and the on-device fallback policy; it does
not exercise the native recognizer. `tests/vitest/speech-text.test.ts` covers
markdown/prose normalization, chunk limits, and pronunciation rules;
`system-tts.test.ts` covers enhanced-voice selection and missing-voice fallback;
`tts-catalog.test.ts` pins the one-pack-per-language catalog; and
`speech-config.test.ts` covers the system/local preference mapping.
`tts-engine.test.ts` covers normal chunk playback, pre-start cancellation, and
mid-playback cancellation.

On-device playback still needs device validation:

- install and remove each Piper pack on Android and iOS, then restart the app
  and confirm status, preview, and offline playback
- measure model init, first-audio latency, chunk gaps, and memory for Piper and
  Kokoro on a low-end Android device
- confirm stop/cancel during synthesis and playback, conversation readback
  prewarm, and system fallback when a pack is missing
- confirm the Japanese system-voice note and the speech-locale mismatch warning

The `test:onboarding` static suite pins the completion-marker contract:
malformed markers are removed, version 0 is sticky, an existing configuration
(migrated from a pre-onboarding version) is treated as complete, and storage
read failures never onboard an existing user.
