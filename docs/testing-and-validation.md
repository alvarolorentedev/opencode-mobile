# Testing And Validation

## Current Strategy

This repository validates behavior primarily through end-to-end flow tests and static checks, not broad unit-test coverage.

That choice matches the app's risk profile:

- most complexity sits in orchestration, not isolated algorithms
- the highest-risk failures involve server interaction, session state, and realtime updates
- platform side effects need integration-level confidence more than helper-level confidence

## CI Gates

Web tab navigation must stay within the mounted app. The custom tab button
prevents the anchor's default browser navigation before calling the router's
tab handler. E2E coverage checks that switching tabs sends no document request
and preserves an unsent chat draft; a full reload can otherwise race input or
workspace selection on slower CI runners.
The Cloud Link renewal fixture waits for the initial last-session bootstrap write
before seeding next-launch data, and waits for the rotated scope to persist
before asserting preservation. Navigation completion alone does not signal
that provider persistence has finished.

`.github/workflows/build.yml` owns Android validation and release. It runs on pushes to `main` and `v*` tags:

- a single `validate` job covers static validation and flow regression testing, and is the required gate for both release jobs
- validation uploads artifacts only on failure (`playwright-report`), with 3-day retention; Playwright retains failed-test traces and screenshots without requiring retries

`.github/workflows/pr-validate.yml` runs the same validate steps on pull requests targeting `main`, so contributor branches get the static, fake-server, and Playwright gates before review. It does not build or publish releases, and it cancels superseded runs for the same PR.

`.github/workflows/ios-release.yml` owns the iOS release, a separate pipeline that runs only on manual dispatch (never on push or tag):

- it re-runs the same `validate` gate before building, then builds and signs the iOS archive on `macos-26`
- it builds an explicit `tag` input when provided, otherwise the latest `v*` tag; either way it checks out the tag rather than the ref the workflow was dispatched from
- it validates the tag against the app version, publishes the GitHub Release asset for that tag, and (with `upload_to_store`) uploads to App Store Connect
- it has no `cancel-in-progress`, so a release in flight is never killed mid-upload

Release automation in `build.yml`:
- Actions artifacts expire after 3 days; the permanent copy is the GitHub Release asset, Play Store upload, or TestFlight upload
- `.github/workflows/cleanup.yml` runs weekly to delete artifacts older than 3 days and keep only the newest Gradle/npm cache

From `TESTING.md`, those gates include:

- `npm run test:ci:static`, which chains lint, typecheck, and the static suites:
  - `npm run test:usage`
  - `npm run test:chat-appearance`
  - `npm run test:vitest` (Vitest: format, transcript turns, record preservation, session reads/pagination, V2 mappers)
  - `npm run test:i18n`
  - `npm run test:provider-runtime`
  - `npm run test:provider-utils`
  - `npm run test:workspace-patch`
  - `npm run test:persistence-hydration`
  - `npm run test:credential-storage`
  - `npm run test:session-cache`
  - `npm run test:favorites`
  - `npm run test:connection-scope`
  - `npm run test:connection-profiles`
  - `npm run test:last-session`
  - `npm run test:active-sessions`
  - `npm run test:notifications`
  - `npm run test:notifications-background`
  - `npm run test:onboarding`
  - `npm run test:connect`
  - `npm run test:architecture`
  - `npm run test:anr`
- `npm run test:fake-server:self`
- Playwright E2E flow tests against the fake OpenCode server

The `foss-release` job also runs `npm run test:foss`, which requires
`git submodule update --init --recursive` in a fresh clone. Its checkout
initializes the submodule automatically. Shared validation and iOS do not
need it. `test:foss` patches temporary copies
of the installed Expo Android sources, checks the proprietary dependencies are
removed and the pinned stub classes are used, and checks repeated preparation
leaves identical inputs. It does not mutate the working dependency tree.

The connection-scope, connection-profile, notification, favorites, and session
cache suites pin down the multi-server storage rule: deterministic password-free
connection scopes, fully validated profile metadata, connection+project session
cache isolation, connection-scoped last sessions, non-secret pending
notification records with per-connection credential resolution, and legacy
values that fail safe instead of being guessed.

The `test:chat-appearance` suite checks that the chat font-size preference
defaults safely and stays within the supported 12–24 px range, and that the
flat-transcript and slim-interface preferences default to off.

The `test:vitest` suite is the standard TypeScript runner (Vitest) for module
behavior that benefits from real imports and module mocking: format/transcript
shaping, bounded-window record preservation, session reads/pagination/coalescing,
and the V2 response/event mappers and provider-auth mapping. These suites import
the real `@/` modules and replace platform/protocol boundaries with `vi.mock`,
instead of transpiling sources through the legacy `loadTs` VM helper (still used
by `test:provider-runtime`, which drives hook source through a custom renderer).

The `test:i18n` suite guards translations: it checks that every language defines
exactly the English key set, that interpolation variables match per key, that
each plural base carries the plural categories required by its locale, and that
the pure language-resolution helper picks the preference, then the device tag,
then English. It also verifies that the generated `lib/i18n/resources.ts`
registry matches the locale folders, that `SUPPORTED_LANGUAGES` and the folders
agree, and that `app.config.ts` exposes the same `supportedLocales`. Regenerate
the registry with `npm run gen:i18n`. During local iteration,
`npm run test:i18n:loose` (`--allow-missing`) tolerates keys that a non-English
locale has not translated yet (they fall back to English at runtime); CI runs the
strict form and enforces full parity.

The `test:architecture` suite is a ratchet on the documented layering: the
provider file size, the combined domain-context surface, and a rule that
`app/` and `components/` never call the network or profile/credential persistence directly. It fails with a
pointed message when a limit is outgrown, so the fix is to extract a domain or
move code to the right layer rather than raise the number.
It also checks that each input surface uses `behavior="padding"` on all
platforms to avoid keyboard overlap without explicit height changes.
It also guards `tabBarHideOnKeyboard: false`, so keyboard visibility changes
do not remove and restore the tab bar's layout space.
`test:anr` verifies that both app variants retain the native `resize`
configuration. These are configuration checks; they do not reproduce a
physical keyboard or prove that issue #62 is resolved.

For keyboard-layout changes, validate Android with a Bluetooth keyboard and
the soft keyboard disabled, then forced visible: focus and type in Chat,
switch sessions/tabs, and check that focus stays stable, the tab bar does not
auto-hide/show, and Chat, Terminal, and full-screen forms have no flicker or
covered inputs. Repeat with the hardware keyboard disconnected and verify iOS
soft-keyboard avoidance. The reported Pixel 9 and Galaxy Tab S9 remain the
device-validation targets.

`test:anr` exercises repeated discovery of a 2,003-model catalog and voice-label
sorting with one shared collator, preserving locale-aware ordering and default
model priority. It also runs the Android content-capture Expo mod in development
and production, checking API guarding, nullable service lookup, repeatability,
and a clear failure if the generated activity changes shape. Existing model
picker E2E coverage checks provider groups, search, selection, and recent models.
Native validation still needs a large-catalog picker open/scroll/search run and
content-capture/TalkBack checks on affected Android devices. These checks reduce
the app-side allocation and rendering pressure; they do not establish that the
Transsion ART/GC stall in the 1.0.39 report is fixed.

## Fake OpenCode Server

The deterministic backend lives under `tests/fake-opencode/`.

- `tests/fake-opencode/server.mjs` emulates the OpenCode 1.x contract.
- `tests/fake-opencode/server-v2.mjs` emulates the OpenCode 2.x `/api` contract (discovery, capabilities, sessions, messages, prompt, diff, permissions, forms, MCP, PTY, VCS, and the flat V2 event stream), reusing the same deterministic state and session helpers.

Its intended job is to simulate the server behaviors this client depends on, including:

- workspace discovery
- config fetch/update
- provider listing and auth metadata
- agent listing
- session creation/listing/status
- message retrieval
- diff retrieval
- todo retrieval
- prompt submission
- session abort
- session title summarization
- permission requests
- SSE event delivery
- file list/path/text/symbol search, conflict/patch application, and VCS diff/status
- archived sessions and experimental worktrees
- MCP lifecycle/config/OAuth endpoints
- PTY REST endpoints and ticket-authenticated WebSocket input/output
- session children, initialization, and shell execution endpoints

## Supported-Contract Fake Server Scenarios

Scenarios in the test infrastructure that correspond to supported app behavior:

- `happy-path`
- `permission`
- `question`
- `stream-disconnect`
- `retry` (V2)

### Happy Path

Simulates a normal session run that completes and returns:

- assistant text
- a patch detail
- one structured diff entry
- two completed todos
- idle session status at the end

Diff retrieval follows the real message-scoped contract: requests without `messageID` return an empty list, while a completed user message exposes its own diff. VCS `mode=git` and `mode=branch` return distinct fixtures so the Files Changed diff scopes can be exercised; V2 exposes the same through `/api/vcs/diff` with `working`/`branch` and, like form and permission lists, rejects VCS requests that omit `location[directory]`, so an unscoped adapter call fails the Files Changed flows instead of silently reporting no changes.

### Permission Scenario

Instead of completing immediately, the server emits a pending permission request and waits for client approval before finishing.

### Question Scenario

The server emits a pending assistant question and waits for an ordered answer payload before finishing.

### Stream Disconnect Scenario

The SSE endpoint intentionally fails, forcing the app to complete the workflow through polling fallback.

### Provider Retry Scenario (V2)

A prompt fails mid-turn (`session.execution.failed`) and the server schedules an automatic retry (`session.retry.scheduled`). The retry status is event-only: the running set excludes it, so a session-list refresh must preserve it. The recovered output is then written to state with no SSE event, so only the busy safety poll can surface it. This reproduces the Android freeze from issue #71.

## Supported-Contract E2E Flows

`tests/e2e/flows.spec.mjs` encodes these supported-contract flows:

### Boot And Ready Chat

- load app
- if needed, switch to Workspace and select the fake project
- return to Chat
- confirm empty-state prompt and input are visible

### Main Happy Path Chat Flow

- send a prompt
- wait for finished assistant text
- verify the resulting chat appears in the Workspace tab
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

### OpenCode 2 Compatibility Flows

- point at the V2 fake server and verify contract detection connects
- verify capabilities, session bootstrap, prompt completion, and transcript rendering work through the V2 adapter
- verify context utilization resolves the session model's limit and renders the latest model call's tokens (`2.3K of 128K input tokens`) instead of "Unavailable"
- verify the derived plan renders (`Plan`, `2 of 2 tasks completed`) from the transcript's `todowrite` tool part, since V2 has no todo endpoint
- verify permission requests and form-backed questions unblock the flow
- verify form option labels are translated back to option values on reply (the fake server records the decoded answer)
- verify the V2 adapter scopes `GET /api/form` and `GET /api/permission/request` with `location[directory]`; the fake server rejects unscoped list calls
- verify the PTY WebSocket streams input/output under `/api`
- verify unsupported actions are hidden rather than failing: no auto-approve toggle, no share/archive actions, no archived toggle, and no LSP/formatter subsystem rows

### SSE Failure / Polling Fallback Flow

- run a prompt when the fake event stream is unavailable
- switch to Workspace
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

the Vitest `session-reads` suite exercises 4,300-record histories in both protocols,
newest-page (20-record) retrieval, backward cursor paging, shared message/diff
reads, V2 shared listing/status, and failure retry/client isolation.
the Vitest `record-preservation` suite covers the bounded-window merge: unchanged record and
array references are preserved, changed records are replaced, new tail records
are appended, and scrolled-up history is prepended without duplicates.
`test:provider-runtime` runs actual provider callbacks and extracted hooks with
deterministic platform/timer boundaries: out-of-order workspace results, stale
same-directory server responses, safety-poll overlap, reconnect snapshots,
subscription cleanup, a single voice submission through message updates, and
serialized profile saves with credential rollback and callback stability.
`test:persistence-hydration` checks field validation, credential-independent
hydration, ordered/deduplicated writes, and preserving unread records.
`test:notifications-background` covers concurrent changes, transient reads/writes,
malformed data, and a re-sent task during background completion checks.
the Vitest `record-preservation` suite is now part of the static CI gate.

### Workspace Mutation And Management Flows

- edit a text file and save it through the conflict-checked VCS patch path
- archive and restore a session through the experimental archived list
- create an experimental worktree and add a remote MCP server

### Terminal Flow

- create a PTY from the fourth tab
- connect with a server-issued ticket over WebSocket
- send one line and verify streamed output

### Favorites And Saved Connection Flows

- favorite sessions in the current and cross-workspace projects, then reopen them
- report a favorite session that no longer exists on the server
- settle rapid favorite taps on the last target
- save two connections that point at separate fake servers exposing the same
  project paths, switch between them, and verify each connection shows only its
  own sessions and restores its own model selection (the session cache,
  remembered session, and model preferences can never leak across servers)

### Cross-Workspace Active Sessions

- list a recently used session from another workspace in the Chat Library
  "Active across workspaces" group and switch to its project on tap
- list a session that is still running (busy) in another workspace
- the group is connection-wide, capped at four, and listed sessions are removed
  from the Chat list below (covered by the flow assertions and `test:active-sessions`)
- `test:active-sessions` unit-tests the selection: running-first ordering, recent
  tail, the four-item cap, and archived/subagent filtering

### Onboarding Flows

`tests/e2e/onboarding.spec.mjs` deliberately omits the `opencode-mobile.onboarding-version`
seed used by `flows.spec.mjs`, so the assistant is exercised:

- fresh install shows the welcome step, walks connect → workspace → preferences skip → permissions skip → ready, enters chat, and does not reappear on relaunch
- every configured step can be skipped (connect and workspace included) and finishing without a workspace lands on the chat workspace prompt
- a failed connection keeps the entered values and allows a retry
- an installation with a stored settings key but no onboarding marker skips onboarding (upgrade migration)
- clearing `localStorage` shows onboarding again
- Settings reopens the Setup assistant with the connection prefilled and returns the app to a working chat without wiping configuration

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
not exercise the native recognizer.

The `test:onboarding` static suite pins the completion-marker contract:
malformed markers are removed, version 0 is sticky, an existing configuration
(migrated from a pre-onboarding version) is treated as complete, and storage
read failures never onboard an existing user.

## Intended Coverage Strengths

This strategy gives confidence in:

- provider-driven app bootstrapping
- workspace selection and session continuity
- session send/refresh lifecycle
- blocking interactions from the server
- provider configuration flow
- resilience to SSE failure
- workspace patch save, archive/restore, worktree creation, MCP addition, and PTY WebSocket streaming

## Coverage Gaps

Cloud Link subscription checks are described in [connect.md](connect.md). Static
checks validate claim/secure-write/finalization ordering on both stores. Mocked
E2E validates explicit Purchase/Restore, silent unfinished-purchase recovery,
pending/cancellation, exact QR continuation, transient/save/finalization retries,
existing-machine access, identity mismatch, rotation and expiry. These do not
prove native store acceptance. Native
camera, secure relaunch/locked-device access, real tunnel upgrades, and
revocation still require explicit physical-device validation.

The service-domain cutover checks reject both legacy control planes before any
request or store proof is sent, preserve isolated legacy secure records, and
discard legacy environment preferences in favor of `api.opencodecloud.link`.
Cloud Link E2E exercises both old preferences through purchase and pairing on the
new production endpoint, plus the existing production/staging recovery flows.
These E2E edits require explicit human validation under `AGENTS.md`; mocked
requests do not verify deployment or real store acceptance on the new domain.

The following important behaviors are present in code but are not obviously covered by the current documented E2E suite:

- conversation mode state machine
- native speech recognition failures and permission edge cases (the pure recovery policy is covered by `test:voice-errors`; the native paths still need device validation)
- TTS playback behavior and the completion watchdog
- notification initialization and background monitoring
- session fork, revert/unrevert, and share/unshare
- attachment upload behavior
- attachment capability rejection and the 10 MB local-file limit
- workspace patch conflict UI and worktree reset/remove
- MCP add/connect/disconnect/enable/disable and OAuth UI completion
- terminal reconnect/termination, ANSI handling, scrollback truncation, and native WebSocket behavior
- auto-approve config toggling
- model enablement filtering and preference reconciliation
- session summarization fallback behavior
- keep-awake and brightness side effects
- working-sound busy/idle transitions
- native SSE transport behavior and real network reconnect timing (web missed-event recovery and deterministic backoff are covered)

These are useful candidates for future validation if the product depends on them heavily.

## Why The Fake Server Matters For Parity

The fake server documents which OpenCode interactions the client expects to exist and how the client reacts to them.

For reimplementation work, it acts as a practical parity contract for:

- endpoint shape expectations
- event types the UI listens for
- blocking workflow semantics
- session completion semantics

## Practical Validation Commands

Useful local commands documented in the repo:

```bash
npm run lint
npm run typecheck
npm run test:workspace-patch
npm run test:fake-server:self
npm run test:e2e:web
npm run build:development:android
```

To debug the fake backend directly:

```bash
npm run test:fake-server
```

## Reimplementation Validation Recommendation

If the app is ever rewritten, parity should be judged at minimum against these behaviors:

1. hydration -> connect -> workspace discovery -> session bootstrap
2. prompt send -> transcript refresh -> diff/todo refresh -> idle completion
3. permission blocking and resolution
4. capability discovery and provider configuration
5. global SSE failure fallback through polling

After that baseline, the next most valuable parity suite would add:

1. attachment handling
2. conversation mode loop
3. notification completion behavior
4. auto-approve and settings persistence

## Migration Coverage Status

The fake server self-test covers the expanded REST contract plus a real ticket-authenticated PTY WebSocket exchange. Playwright covers patch save, archive/restore, worktree creation, MCP addition, and terminal input/output. It does not prove full terminal emulation, native WebSocket behavior, MCP OAuth UI completion, attachment capability, provider OAuth callback, or native reconnect behavior.

Android native validation happens on every CI run in the tagged/`main`/manual `android-release` job in `.github/workflows/build.yml`; there is no separate push-time Android development build gate.

## Assessment Validation Limits

These checks establish behavior and bounded request counts, not native frame
rate, launch latency, battery use, or memory. Terminal socket output retains
its existing per-chunk React updates and 100,000-character cap; introduce batching
only after sustained-output profiling demonstrates a bottleneck. Physical-device
voice, background notification, and virtualized-list scrolling/accessibility checks
remain necessary. Changes under `tests/e2e/` or `tests/fake-opencode/` require
explicit human validation as specified by `AGENTS.md`, even after all automated
gates pass.

## UX simplification validation

The existing Playwright flows now cover direct approval and mode controls, thinking-slider adjustment in the model picker, draft retention, picker dismissal, settings updates, unsupported approvals, model-first names, starter draft selection, library search-empty copy, immediate changed-file opening, deleted content explanation, search failure recovery, completion overlays, patch-to-turn review, approval scopes, question descriptions, and setup's single action. The fake completion message now includes its existing parent user message ID to cover review navigation. File-state/error edge cases use browser route overrides. Both test and fake-server edits require human validation.

Before committing this change, run the static, fake-server and full web gates. Native manual checks must cover iOS light/dark, regular/slim, larger text, keyboard visibility, pending blockers, VoiceOver action names/slider adjustment/focus, and Android hardware/soft keyboard Back behavior. Test edits require explicit human validation under AGENTS.md. Automated browser checks do not replace these native checks.

The composer approval toggle is now the sole Chat approval affordance: the shield represents asking, the warning represents auto-approval, and unsupported V2 servers omit the control. The adjacent agent icon opens the existing selector. Thinking is adjusted through the shared Settings slider at the top of the model picker. The composer flow covers direct approval failure/retry, agent selection, thinking keyboard adjustment, draft retention and picker dismissal.

## Add connection redesign validation

Connection creation now enters through a shared Cloud Link/Manual chooser in
Settings and onboarding. The web flows cover manual form retry and duplicate
submission guards, subscription dismissal back to the chooser, subscriber
auto-pairing without a subscription-sheet flash, invalid/untrusted QR replacement,
automatic test/production purchase routing and environment isolation, and separate restored-machine
management. The camera-active status chip was replaced by the appbar options
action (`connect-options`), so entitlement assertions now check that the
subscription sheet is absent instead. The pairing-link alternative and machine
management now live in that options sheet. Existing purchase verification,
secure-save/finalization ordering, exact QR continuation, expiry and
credential-rotation flows remain covered.

Native acceptance still requires camera permission requested before the pairing
surface with allow/deny-cancel behaviour, deep-link gate bypass, focus/background
suspension, iOS/Android safe areas, larger text, screen-reader focus,
keyboard/back behavior and real native Subscribe/Restore. Updated E2E
files require explicit human validation under AGENTS.md. Build/static/mocked
flow results do not replace these acceptance checks.

## Changes chip validation

Chat no longer has Session / Files Changed tabs. Diff flows enter through the centered chip above the composer or a message's Review changes action. Coverage checks FAB/chip vertical alignment at mobile width, progress-overlay opening, standalone FAB visibility when the chip is hidden, file/line counts, zero-change hiding, overlay close/reopen with an unsent draft, scope switching, earlier-turn review, and blocking-request dismissal. The provider and fake-server contract are unchanged. Chip text and accessible names reuse the existing translated diff summary and Review changes labels.

Run the static, fake-server self-test, and full web E2E gates. E2E edits require explicit human validation under AGENTS.md. Native checks remain necessary for light/dark themes, larger text, safe areas, keyboard layout, screen-reader names, and Android Back dismissal.

The compact diff-sheet flow also verifies its full viewport width, initial bottom-sheet position, compact file-row height, expanded accessibility state, and lack of horizontal overflow. Diff-source selection remains reachable from the header's three-dot button; the selected scope/turn is included in its accessible name. The shared overlay's other presentations remain unchanged. Native acceptance must check wrapped code and long paths at larger text sizes.


## Session library recovery (#64)

Session-read regressions cover mixed archived/active records and pagination through an active-only page. The fake V1 server reproduces the inclusive `archived=true` contract. Web flows cover idle-session reopening, double taps, archived-card restoration with retained history, and cross-workspace restoration with failure/retry. Run `test:ci:static`, `test:fake-server:self`, and `test:e2e:web`. TestFlight validation with OpenCode 1.18.34, card taps, swipe actions, and accessibility remains required. Changes in the fake-server and E2E directories require explicit human validation under AGENTS.md.


## Cross-workspace favorite CI regression

The favorite flow waits for server-side prompt completion and the selected workspace rather than a fixed delay. It targets the favorite row directly, since the same session may also appear in the Active group. Provider runtime coverage reproduces cache pruning while bootstrap reads have arrived but capability discovery is still pending. Pruning waits for bootstrap completion and protects the pending deep-link target, then resumes with the selected, running, and conversation sessions. Validate with Node 22 and `CI=true EXPO_PUBLIC_E2E_MODE=1`, including repeated focused favorite flows and the full three CI gates. E2E changes still require explicit human validation under AGENTS.md.
