# Testing And Validation

# Testing And Validation

All static and unit/contract suites now run under Vitest from `tests/vitest/`
(`npm run test:vitest`, invoked by `npm run test:ci:static`). The standalone
Node `.mjs` suites were migrated here; suite names used later in this document
(for example `test:i18n`, `test:provider-runtime`, `test:architecture`) are the
historical script names, and their equivalent today is
`tests/vitest/<name>.test.ts`. The deterministic fake servers
(`tests/fake-opencode/`) and the Playwright specs (`tests/e2e/`) are unchanged.
The flow specs are split by domain (`tests/e2e/<domain>.spec.mjs`) over shared
helpers in `tests/e2e/helpers/flows.mjs`. Suites that are not yet typed are
listed in `tsconfig.tests.json`; see [known gaps](known-gaps.md).

## Validation Cost And Fast Paths

Measured baseline on 2026-10-23 against the previous serial workflow:

- static checks: 71s on CI (~83s locally), including 47s of lint, 13s app
  type-check, 10s test type-check, and 13s for the Vitest suites (539 checks)
- fake-server self-test: 7s
- Playwright: 510s of test execution for 161 flows plus ~69s for one web
  export/server startup
- the previous serial `validate` job: 12.4min, or up to 20min when the
  Playwright browser install stalled
- the new one-job/four-worker layout: 161 flows in 3.2min of test execution,
  or 4.0min including a cold `--clear` export and server startup

The browser flows, not Vitest, are the cost. CI now runs one E2E job with one
web export and four Playwright workers. Each worker owns a fake V1/V2 server
pair, so the fake server's global scenario is isolated. Workers key that mapping
on Playwright's `parallelIndex`, which stays inside `0..workers-1` when a worker
is restarted; `workerIndex` grows on restart and would point at a server that
was never started. The web build is
URL-agnostic: a Playwright fixture sets the worker's backend URL at runtime,
and saved connection settings still take priority.

For local iteration:

```bash
# Once, to produce the URL-agnostic export
npm run build:web:e2e

# Terminal 1: serve the existing export without rebuilding
npm run serve:web:prebuilt

# Terminal 2: run only the spec you changed
npx playwright test tests/e2e/chat.spec.mjs
npm run test:e2e:smoke          # 17 critical flows
npm run test:e2e:last-failed    # rerun the previous failures
```

Concurrent local runs must not share fixed ports. Use the isolated wrapper,
which reserves a contiguous fake-server port block and a fresh web port:

```bash
npm run test:e2e:web:isolated -- tests/e2e/realtime.spec.mjs
E2E_SKIP_BUILD=1 npm run test:e2e:web:isolated -- tests/e2e/realtime.spec.mjs
```

Workers default to 2 locally and 4 in CI. Override with `E2E_WORKERS`; the port
block size follows that count. `E2E_WEB_PORT` and `E2E_FAKE_PORT_BASE` are
available for manual setups.

`build:web:e2e` keeps Metro's cache, so a warm export is a few seconds. Set
`E2E_CLEAR=1` if you need to rule out a stale export.

`npm run validate:fast` is the pre-push loop (static, fake-server self-test and
the smoke set). The full `test:e2e:web` gate remains required before release
and in CI; targeted specs and the smoke set are for iteration, not a substitute
for the full suite.

ESLint and TypeScript keep local caches (`--cache`, `--incremental`), and the
CI jobs cache `.eslintcache`, `*.tsbuildinfo` and the Playwright browser. A
cold static run is ~45s locally; a warm one is ~15s (Vitest is the floor).
`tests/vitest/typecheck-ratchet.test.ts` keeps the
`tsconfig.tests.json` denylist empty. The dynamic `loadTs`/`hookRuntime` helper
remains available for hook-source tests and is typed by
`tests/helpers/runtime.d.mts`.

## Extension Management Coverage

`extensions.test.ts` covers global/project config target resolution, JSONC-preserving MCP/plugin/command edits, skill generation, transaction backup/temp verification, rename failure recovery, and backup restoration. `tests/e2e/extensions.spec.mjs` covers project plugin/skill/command creation, MCP/plugin/skill/command removal, command suggestions in the composer, General/Project sharing, and backup restore against the fake V2 server. The fake server now exposes scoped config documents, plugin/skill/command lists, absolute extension file reads/writes, and a fixed-command shell fixture. Any change to `tests/fake-opencode/` or `tests/e2e/` still requires explicit human validation.

## Audit remediation regressions

`audit-races.test.ts` covers composer revision ownership, explicit failed-input
recovery, bootstrap/connection/session changes, partial blocker-map updates and
abort/resubmit races in the actual prompt hook. `read-deadline.test.ts` exercises
both installed SDKs through the shared transport: stalled headers and bodies,
coalescing recovery, caller signals, late-result rejection, stream/mutation
exclusions, exact UTF-8 authentication and advertised-byte diagnostics.
Profile tests exercise interleaved manual, Cloud Link and preference writes.
Hydration tests preserve unread metadata and prevent credentials from being
applied to an unknown/default server. Prompt ownership also covers stale client
callbacks, overlapping aborts and notification records moved during renewal.
`optimistic-flows.test.ts` covers local-first session selection, background
prompt reconciliation, optimistic permission removal/rollback, and interaction
refresh suppression while a reply is in flight. `workspaces.test.ts` also guards
per-domain workspace value memoization and cross-server library ordering, plus
network ownership, last-project closure, closed-project projection, and the
single active-session catalog read per connection.
`provider-events.test.ts` covers coalesced event refreshes, immediate local
deletion, and the scheduled-refresh fallbacks. `session-reads.test.ts` covers
the status-only V2 polling read.
The installed React Native URL implementation guards legacy URL sanitation.
Usage tests prefer authoritative totals and mark partial history; attachment tests
reject declared/encoded oversize and stop bounded streams before file creation.
Widget tests assert directory request budgets and retention beyond displayed rows.
`files-panel.test.ts` guards lazy row construction and navigation for 1,000 files;
rendered/native acceptance must still verify scrolling, keyboard and accessibility.

Custom gateway-header coverage: `connection-headers.test.ts` drives row
validation, reserved-name rejection, canonical comparison, active/profile
SecureStore round-trips and the web test-secret path;
`connection-profiles.test.ts` proves header resolution stays scoped to the
owning connection and never reaches AsyncStorage; `read-deadline.test.ts` checks
the Basic-auth + custom-header merge; `connection-dialog.test.ts` covers row
editing, masked values and pre-probe rejection; `connection-errors.test.ts`
locks the API-base hint to non-/api URLs and the version hint to /api URLs;
`connect.test.ts` and `terminal.test.ts` prove native terminal upgrades receive
the full header set.
The fake-server self-test gates REST, SSE and PTY upgrades, and
`manual-connection.spec.mjs` connects through a header-gated V2 server and
asserts REST/SSE delivery plus secret-free AsyncStorage. E2E and fake-server
changes require explicit human validation under `AGENTS.md`; the web E2E cannot
exercise native WebSocket headers.

Finite GET/HEAD API reads have one 30-second deadline through body consumption.
Expired operations release coalescing and reject late results; SSE retains its
existing watchdog and mutations are neither timed out nor automatically retried.
Network diagnostics count requests and known Content-Length bytes, not exact
transferred bytes. No response is duplicated solely for accounting.

Audit implementation acceptance (2026-10-14): static CI passes with 318 Vitest
checks, and both v1/v2 fake-server self-tests pass. The full web gate passes 134
flows. The unchanged project focus assertion caught scroll anchoring dismissing
search input; disabled anchoring and stable row data fix it. A separate Chromium
check at 393×852 and 1280×800 browsed 1,000 files, mounted 66 rows initially,
retained input focus and opened the last file without horizontal overflow.
Its only console misses were expected `/api/health` and `/global/health` probes;
there were no page exceptions or framework overlays.

Android development compilation and FOSS preparation pass. An isolated API 36
ARM64 app validates password-backed profile saving, prompt admission/completion
and native scrolling through the 1,000-file folder. Earlier SDK-location failure
notes below describe prior runs, not this environment. Native development mode
still reports SDK import cycles (also seen on unchanged main); an Expo Router
early-mount linking warning occurred on the first launch without breaking these
flows. Physical-device battery/thermal/frame timing, complete media/keyboard/
accessibility acceptance and this patch's iOS runtime remain unverified.
No fake-server/E2E source contract, dependency or release version changed.


## Feed attachments and OpenCode 2 inbox

`tests/vitest/feed.test.ts` covers picker data normalization, preview decoding
and limits, native temporary-file cleanup, V2 file mapping, file-only messages,
delivery preferences, inbox events and provider admission/reconciliation races.
The fake V2 server exposes deterministic inbox step/completion controls plus
list/cancel/delivery changes; its self-test checks delivery IDs and file bytes.
Web flows cover square previews, document downloads, sent-file placement and
reload, Steer/Append selection, multiple waiting messages, inbox recovery,
polling delivery and rejected-send draft retention. Browser review also checks
inline MP4 playback with contain fit; native acceptance covers video playback
alongside audio play/pause/background/close and temporary-file cleanup.

Run all three CI gates. Fake-server and E2E changes require explicit human
validation under AGENTS.md. Native acceptance remains required for media
playback/background/close, temporary-file cleanup, document handoff, keyboard
layout, safe areas and screen-reader actions on iOS and Android.

## Inbound sharing and Android widgets

`tests/vitest/share.test.ts` and `share-flow.test.ts` cover Android `file:/` URI
normalization, encoded filenames, text/HTML and media streams, duplicate display
names, mixed content, limits, all-rejected warnings, delayed hydration, explicit
current/other/new destinations, retry without duplicate creation, duplicate taps,
cancellation, connection changes, one-shot consumption, TTL, draft merging and
warm re-entry while native resolution is pending.
`native-share-patch.test.ts` checks the prebuild patch against installed source,
idempotence, unique/bounded cache copies and failure before writes on unsupported
versions. `tests/e2e/share.spec.mjs` remains unchanged web route smoke coverage;
the native share sheet requires device acceptance.

Manual Build workflow runs with `build_android=true` also validate the actual
signed, minified release APK on an API 36 x86_64 emulator. The APK must contain
single/multiple share filters, the app scheme, the dynamically loaded scheme
resource and the patched cache-copy code. `tests/native/android-sharing.py`
then covers cold/warm/repeated text shares, existing/New chat selection, draft
preservation, one-shot handoff, and PNG/PDF sharing through Android Files with
real URI grants. The existing fake V2 server confirms nothing auto-submits.
The workflow uploads screenshots, accessibility trees, manifest and logs as
`android-sharing-evidence`, including on failures. Emulator coverage does not
establish OEM share-sheet behaviour or physical-device accessibility.
Set `share_apk_run` to an existing Build run ID to repeat native validation
against its exact release APK without another compilation (`build_android=false`).
Inspection of the earlier release APK confirmed both the native patch and
`share_into_scheme` were absent. Source compilation and an explicit resource
keep rule address these independent build defects; the release APK checks
prevent either from silently returning.
The first completed cold-share emulator flow also exposed tab replacement on
return from the preview: it recreated the composer and dropped the local draft.
Add/Discard now use `dismissTo`, with the installed stack router's route identity
covered by Vitest and the draft asserted before and after warm native shares.

`native-intent.test.ts` uses the installed React Native URL implementation to
reproduce the custom-scheme hostname failure and verifies cold/warm share routing,
repeat receipts, and unrelated-link preservation. The redirect fix needs no
native plugin change; Android device acceptance must still confirm the preview,
conversation selection and attachment handoff with the app closed and open.
Redirect verification (2026-10-13): the native-URL regression failed before the
fix and passed after it. Static CI (286 Vitest checks), both fake-server
self-tests and all 129 web flows pass. Android development prebuild succeeds;
Gradle compilation remains blocked by the missing Android SDK.

`widget-flow.test.ts` exercises recent reply selection, descendant/global blocker
grouping, removal of settled requests, real todo progress/completion, redaction,
malformed snapshots, independent project reads, failed-read retention, global
events/resume/polling refresh, stale scope rejection, serialized writes, preference
changes during queued writes, headless privacy enforcement, responsive trees,
fixed widget locales and route targets. Existing
`widget-snapshot.test.ts` preserves the legacy snapshot read contract.
Rendering coverage compiles the real source with Expo's Android Babel preset and
React Compiler enabled in development and production, then runs the installed
widget serializer with real primitives. It covers all three widgets, both themes,
small/large sizes, visible content and backgrounds, empty states, hidden previews,
completed plans, accessibility and exact chat links. Foreground and headless
integration tests mock native boundaries only, read real snapshot storage logic,
and verify awaited dispatches, independent instance failures and platform guards.
Mock JSX trees alone cannot detect compiler hooks or unsupported Fragments.

Required gates: `test:ci:static`, `test:fake-server:self`, `test:e2e:web`,
`test:foss`, and `build:development:android`. E2E and fake-server handlers are not
changed for this feature; any future changes to them require explicit human
validation under AGENTS.md.

Native release acceptance remains blocking:

- Share image, audio, video, PDF, text/HTML and generic files from Files/Photos and
  another app; test cold/warm launch, multiple files with identical names,
  accompanying text, oversize/unreadable items, all-rejected warnings and expiry.
- Confirm current, other-project and New chat destinations, retry/Discard,
  preserved draft and explicit send. Verify warm shares while the app is already
  open and incomplete onboarding.
- Add all three widgets in a minified release, resize to minimum/large sizes,
  verify both themes, large text and TalkBack, reboot and reopen after force-stop.
  Verify existing placed widgets repaint after upgrade without removing them;
  every widget must show a background, title and content or an explicit empty
  state, rather than an invisible clickable rectangle.
- Receive replies and blockers in another project with the library closed;
  answer a permission/question and confirm its removal. Exercise child/global
  blockers, current-chat plan changes/completion and empty plans.
- Disable previews and verify all placed widgets and persisted snapshot content;
  switch servers while reads are running. With notifications denied, widgets
  still refresh while the app runs. Suspended widgets retain absolute update
  times; no new periodic WorkManager job or foreground service is introduced.
- iOS launcher quick actions remain unchanged and still require signed-device
  cold-start acceptance. iOS Share/Widget extensions remain deferred.

Implementation verification (2026-10-13): static CI passes with 286 Vitest
checks; both fake-server self-tests, all 129 web E2E flows and FOSS preparation
pass. Development and production Android prebuilds generate all three receivers,
zero periodic update intervals and the release R8 keep rules. An isolated Kotlin
probe with Android/Expo stubs passes text-stream/caption handling, duplicate
filenames, known/unknown-size limits and partial-file cleanup. The blank-widget
repair also passes production Android export with Hermes bytecode generation.
Both development and minified release Gradle attempts stop because the SDK
location is missing. Actual device
rendering, TalkBack, native share permissions and minified/R8 acceptance remain
unverified. No fake-server/E2E contract or dependency version was changed; iOS
Share/Widget extensions remain deferred.

## Current Strategy

Cloud Link Subscription Settings coverage is described in [connect.md](connect.md).
Validate the selected grouped-action layout in dark/light themes, narrow widths,
larger text, sheet dismissal and screen-reader navigation. Check real App Store
and Google Play handoff separately from the mocked E2E driver. E2E additions
require explicit human validation under AGENTS.md.

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
project selection on slower CI runners.
The Cloud Link renewal fixture waits for the initial last-session bootstrap write
before seeding next-launch data, and waits for the rotated scope to persist
before asserting preservation. Navigation completion alone does not signal
that provider persistence has finished.

The OpenCode 2 project regression flow opens the picker, checks a server
project that was never opened on this connection is not listed, adds a
directory, and checks the serve's `/api/project` response now includes it. It
sends a prompt through the app, checking the HTTP 200 admission response and
cleared composer. It checks that catalog refresh, tab navigation, reconnect,
and reload preserve the selected path and keep it in the picker from the
persisted opened list. It also opens a favorite in that project after refresh
and reload, checking the retained transcript. It waits for the active-project
and favorite storage writes before reload. Provider runtime coverage checks
that a fresh connection seeds the server current project, that an unlisted path
falls back to the most recent opened project, that a server-resolved worktree
is kept and opened, that an opened project or a server-resolved sibling
checkout can be opened even when `project.list()` reports another canonical for
the same repository, that a truly unresolvable path stays rejected. The v1/v2 worktree flow closes
a server worktree and then closes its local project entry. Worktree catalogs omit known project canonicals,
so Remove/Reset is not offered for a repository's own checkout.

`.github/workflows/build.yml` owns Android validation and release. It runs on pushes to `main` and `v*` tags:

- a single `validate` job covers static validation and flow regression testing, and is the required gate for both release jobs
- on pushes to `main` only the `validate` job runs; `android-release` and `foss-release` are limited to `v*` tags and manual dispatches with `build_android: true`
- validation uploads artifacts only on failure (`playwright-report`), with 3-day retention; Playwright retains failed-test traces and screenshots without requiring retries

`.github/workflows/pr-validate.yml` runs the same validate steps on pull requests targeting `main`, so contributor branches get the static, fake-server, and Playwright gates before review. It does not build or publish releases, and it cancels superseded runs for the same PR.

`.github/workflows/ios-release.yml` owns the iOS release, a separate pipeline that runs only on manual dispatch (never on push or tag):

- it re-runs the same `validate` gate before building, then builds and signs the iOS archive on `macos-26`
- it builds an explicit `tag` input when provided, otherwise the latest `v*` tag; either way it checks out the tag rather than the ref the workflow was dispatched from
- it validates the tag against the app version, publishes the GitHub Release asset for that tag, and (with `upload_to_store`) uploads to App Store Connect
- it has no `cancel-in-progress`, so a release in flight is never killed mid-upload

Release automation in `build.yml`:
- APK/IPA workflow artifacts expire after 1 day; the permanent copy is the GitHub Release asset, Play Store upload, or TestFlight upload

The `validate` gate runs two parallel job families:

- the `static` job runs `npm run test:ci:static`, the single static entrypoint.
  It runs lint, TypeScript type-checking for the app and for `tests/`
  (`npm run typecheck:tests`), the Vitest suites (`npm run test:vitest`), and the
  static contract suites. The script in `package.json` is the source of truth
  for the exact suite list. The runner executes the independent steps
  concurrently and keeps ESLint/TypeScript caches. `typecheck:tests` uses
  `tsconfig.tests.json`, which excludes the harness-heavy suites listed there
  until they can be typed.
- the same job runs `npm run test:fake-server:self`.
- the `e2e` job builds one web export, serves it once, and runs Playwright with
  four workers. Each worker owns a fake V1/V2 server pair; the test fixture
  selects the worker's URL at runtime, so the export is shared.

The `foss-release` job also runs `npm run test:foss`. It patches temporary
copies of the installed Expo Android sources using a local stub-source fixture,
checks proprietary dependency removal and missing-source errors, and checks
that repeated preparation leaves identical inputs. It does not mutate the
working dependency tree or download sources. The FOSS release build downloads
its pinned Firebase stub revision when no `FIREBASE_STUB_SRC_DIR` is supplied;
other builds do not need that source checkout.

The connection-scope, connection-profile, notification, favorites, and session
cache suites pin down the multi-server storage rule: deterministic password-free
connection scopes, fully validated profile metadata, connection+project session
cache isolation, connection-scoped last sessions, non-secret pending
notification records with per-connection credential resolution, and legacy
values that fail safe instead of being guessed.

The `test:chat-appearance` suite checks that the chat font-size preference
defaults safely and stays within the supported 12–24 px range, and that the
flat-transcript and slim-interface preferences default to off.

`tests/vitest/native-inputs.test.ts` exercises the real composer and shared
input with the existing hook driver and mocked platform boundaries. It covers
iOS native auto-grow caps (no measured height or hidden measurement node),
Android/web content-size callbacks, and single-line alignment overrides without
altering password values. These checks do not reproduce UIKit rendering.

For native input changes, verify iOS typed newlines, automatic wrapping, long
pasted prompts, scrolling at the cap, deletion, clearing, regular/slim layouts,
larger text, focus/selection, and keyboard visibility. Long server passwords
must remain masked on one row through typing, paste, blur/refocus, and reopening
the connection dialog. Repeat composer growth/scrolling on Android. Native
checks are required before considering the iOS password workaround verified.

iOS now grows the native input instead of measuring a hidden copy, because the
on-device measurement lagged a layout pass behind the text (the simulator run
did not reproduce it). Confirm same-keystroke growth, the regular/slim caps, and
shrink-on-delete on a physical iPhone. The iOS 26.5 simulator acceptance run
confirmed masked passwords through typing, paste, blur/refocus, and dialog
reopening. Android runtime and the separate Mac runtime still require native
acceptance checks.

The `test:vitest` suite is the standard TypeScript runner (Vitest) for module
behavior that benefits from real imports and module mocking: format/transcript
shaping, bounded-window record preservation, session reads/pagination/coalescing,
and the native V2 presentation projections/event dispatcher and provider-auth mapping. These suites import
the real `@/` modules and replace platform/protocol boundaries with `vi.mock`.
The remaining hook-source suites use the typed `loadTs`/`hookRuntime` helper,
which is covered by `tests/helpers/runtime.d.mts`.

Subagent blocking and event coverage is unit-level: `pending-interactions.test.ts`
covers `collectDescendantSessionIds`, descendant permission/question surfacing,
and `isPromptErrorVisible`; `provider-events.test.ts` covers the `handleProviderEvent`
MCP-auth alert, part-delta/project-directory refresh, and the native V2 event
dispatch; `v2-mappers.test.ts` covers `mapSavedPermission`. There is deliberately
no fake-server or Playwright scenario for these surfaces yet (MCP auth failure,
saved permission rules, subagent prompt routing), so end-to-end confirmation
remains a follow-up; the fake-server contract is unchanged.

`test:provider-utils` also pins the session/status equality guards
(`areSessionListsEqual`, `areSessionStatusMapsEqual`) that let a no-op poll keep
the previous state identity, so the split session/project contexts do not churn
on every refresh.

The `test:i18n` suite guards translations: it checks that every language defines
exactly the English key set, that interpolation variables match per key, that
each plural base carries the plural categories required by its locale, and that
the pure language-resolution helper picks the preference, then the device tag,
then English. It also verifies that the generated `lib/i18n/resources.ts`
registry matches the locale folders, that `SUPPORTED_LANGUAGES` and the folders
agree, and that `app.config.ts` exposes the same `supportedLocales`. Regenerate
the registry with `npm run gen:i18n`. During local iteration,
`npm run test:i18n:loose` sets `I18N_ALLOW_MISSING=1` and tolerates keys that a
non-English locale has not translated yet (they fall back to English at runtime);
CI runs the strict form and enforces full parity.

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

Keyboard regressions also guard against adding the header safe-area inset to
Chat/Terminal avoidance. `native-inputs` checks that content-sized and full-height
overlays shrink inside a stable full-screen padding frame. On iOS, verify the
Chat composer and terminal accessory sit directly above the soft keyboard, and
Settings → Voice → Speech locale scrolls into view on focus and
remains reachable through keyboard dismissal, rotation, and larger text.

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

- `tests/fake-opencode/server-v1.mjs` emulates the OpenCode 1.x contract.
- `tests/fake-opencode/server.mjs` emulates the OpenCode 2.x `/api` contract (discovery, capabilities, sessions, messages, prompt, diff, permissions, forms, MCP, PTY, VCS, and the flat V2 event stream), using canonical native fixtures and shared version-neutral filesystem/terminal infrastructure.

Both servers raise `keepAliveTimeout` above a single flow's duration. Playwright's
`APIRequestContext` pools keep-alive sockets per test, and Node's 5s default
could close an idle connection between a long UI step and the next control
request, which surfaced as an intermittent `apiRequestContext ... socket hang
up` failure. The test runner owns the process lifetime, so the longer timeout
does not leave stray connections after the run.

The V2 self-test submits prompts through the pinned `@opencode/client` SDK,
checks that the HTTP 200 admission identifies the stored user message, and
verifies that session events carry that session's directory. Non-session events
use the server's main directory. Scoped session lists filter by `directory`;
unscoped lists include every project for the Chat Library's recent group.

Its intended job is to simulate the server behaviors this client depends on, including:

- project discovery
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

Diff retrieval follows the real message-scoped contract: v1 requests without `messageID` return an empty list; v2 selects a turn with native `from`, while a completed user message exposes its own diff. VCS `mode=git` and `mode=branch` return distinct fixtures so the Files Changed diff scopes can be exercised; V2 exposes the same through `/api/vcs/diff` with `working`/`branch` and, like form and permission lists, rejects VCS requests that omit `location[directory]`, so an unscoped client call fails the Files Changed flows instead of silently reporting no changes.

### Permission Scenario

Instead of completing immediately, the server emits a pending permission request and waits for client approval before finishing.

### Question Scenario

The server emits a pending assistant question and waits for an ordered answer payload before finishing.

### Stream Disconnect Scenario

The SSE endpoint intentionally fails, forcing the app to complete the workflow through polling fallback.

### Provider Retry Scenario (V2)

A prompt fails mid-turn (`session.execution.failed`) and the server schedules an automatic retry (`session.retry.scheduled`). The retry status is event-only: the running set excludes it, so a session-list refresh must preserve it. The recovered output is then written to state with no SSE event, so only the busy safety poll can surface it. This reproduces the Android freeze from issue #71.

## Supported-Contract E2E Flows

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
the Vitest `transcript-visibility` suite covers the fixed detailed display
across user, assistant, tool-only, reasoning-only and patch-only entries plus
hidden file-mutating tools; `transcript-rows` covers
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
not exercise the native recognizer.

The `test:onboarding` static suite pins the completion-marker contract:
malformed markers are removed, version 0 is sticky, an existing configuration
(migrated from a pre-onboarding version) is treated as complete, and storage
read failures never onboard an existing user.

## Intended Coverage Strengths

This strategy gives confidence in:

- provider-driven app bootstrapping
- project selection and session continuity
- session send/refresh lifecycle
- blocking interactions from the server
- provider configuration flow
- resilience to SSE failure
- project patch save, worktree creation, MCP addition, and PTY WebSocket streaming

## Coverage Gaps

Cloud Link activation checks cover 3/6/12/15-second backoff, request time within
the shared 120-second budget, mixed transient failures, explicit saved-credential
retry, permanent failures, general/manual reconnect exclusion, stale results,
background suspension and teardown cleanup. Provider-hook coverage verifies
foreground recovery does not overlap or restart activation and rescan retains
the saved profile. Protocol checks preserve HTML 1033 before SDK parsing and
keep 401/403 and TLS/certificate failures immediately actionable.

Recovery classification is pinned by `tests/vitest/connection-classification.test.ts`
(tunnel-startup, offline, timeout, auth, entitlement, server-incompatible,
unknown, and the retry/auth policies). `tests/vitest/provider-runtime.test.ts` covers
the liveness watchdog (one re-subscription per staleness window, foreground
cycle, no traffic while healthy), the queued full reconcile behind an in-flight
safety poll, auth-failure stream stop with a single provider notification, and
the terminal reconnect on a rotated credential client.
`tests/vitest/connect-recovery.test.ts` covers single-flight concurrent connects
(one project discovery), same-machine rotation using the soft reset (project
preserved), and data-plane revocation (state cleared once, Cloud Link recovery
reused). `tests/vitest/terminal.test.ts` covers jittered bounded reconnect
delays and cursor-preserving reconnect with rotated credentials.
`tests/e2e/realtime.spec.mjs` adds a silently stalled SSE flow (watchdog
re-subscribes and the released stall reconciles a missed blocker, both
protocols) and a browser offline/online drop that recovers the retained session
without re-submitting the prompt.
`tests/e2e/network-resilience.spec.mjs` adds deterministic 4G latency and an
offline queued prompt that is delivered once after reconnect. The fake server's
network injector, all E2E additions, and the web offline transitions require
explicit human validation under AGENTS.md.

These fake-server and E2E changes require explicit human validation under
AGENTS.md. Device acceptance still needs Wi-Fi/cellular transitions, sleep/wake
resume, real revocation, and Cloud Link renewal with a live terminal and editor
draft.

The web Cloud Link flows use controlled time and mocked tunnel responses to
check waiting beyond 15 seconds without recovery controls, automatic connection,
neutral timeout without automatic restart, explicit Retry without replaying
claim/access, and regenerated-QR recovery. E2E changes require explicit human
validation under AGENTS.md. Real-device acceptance remains outstanding: delayed
desktop approval, approval followed by slow DNS/tunnel startup, denial/TTL expiry
followed by a regenerated QR, and background/resume during the wait.

Local validation on 2026-10-12 passed `test:ci:static` (including 199 Vitest cases),
both fake-server self-tests and all 119 web E2E flows against the final export.
Android development prebuild completed; Gradle compilation stopped with
`SDK location not found`. Explicit human validation of these E2E changes and
the physical-device flows remains pending.

Cloud Link subscription checks are described in [connect.md](connect.md). Provider
checks cover rejected/false native initialization and billing failures
during product and existing-purchase queries on both stores. Retry reconnects and
replays initialization while checkout stays disabled; purchase checkpoints retain
their existing recovery path. The V2 inbox E2E resets the shared boot backend
before opening chat so the preceding attachment flow cannot leak its conversation.
Billing recovery validation (2026-10-13): static CI (291 Vitest checks plus script
suites), both fake-server self-tests, all 134 web flows and the Android development
build pass. An earlier full rerun had intermittent V2 terminal, file-diff and
polling failures; all three passed separately and in the final full run without
changes to those flows. On 2026-10-13 the user explicitly validated the one-line
inbox E2E reset in this chat. Real Google Play checkout remains unverified.
No release version changed.

Static checks validate claim/secure-write ordering, StoreKit finalization on iOS, and
the backend-owned Google acknowledgement (Android never calls
`finishTransaction`). Mocked E2E validates explicit Purchase/Restore, silent
unfinished-purchase recovery, pending/cancellation, exact QR continuation,
transient/save retries, existing-machine access, identity mismatch, rotation and
expiry. These do not prove native store acceptance. Native
camera, secure relaunch/locked-device access, real tunnel upgrades, and
revocation still require explicit physical-device validation.

`test:connect` covers the low-level Cloud Link API, pairing/trust parsing,
credential storage and app-config contract. `tests/vitest/connect-recovery.test.ts`
is complementary: it exercises the actual provider hooks with deterministic
app-state, time, native store and storage boundaries. It covers healthy reopen,
background expiry and retry cancellation, cold-launch store readiness, shared
credential access, stale recovery success and failure after switching
connections, and renewal with Settings mounted. Profile checks distinguish
machines/environments while preserving manual scope
matching. The live-renewal E2E checks one active saved row, fresh username, panel
close/reopen and remembered-session continuity without a document reload.
On 2026-10-11, the user explicitly confirmed the live-renewal flow and all Android
background/resume and full-relaunch checks on a build containing this fix,
satisfying the human validation requirement for these E2E changes under AGENTS.md.
Static CI, both fake-server self-tests and all 116 web E2E flows passed. Android
development prebuild passed; local Gradle compilation remains unverified because
no Android SDK is configured.

The service-domain cutover checks reject both legacy control planes before any
request or store proof is sent, preserve isolated legacy secure records, and
discard legacy environment preferences in favor of `api.opencodecloud.link`.
Cloud Link E2E exercises both old preferences through purchase and pairing on the
new production endpoint, plus the existing production/staging recovery flows.
These E2E edits require explicit human validation under `AGENTS.md`; mocked
requests do not verify deployment or real store acceptance on the new domain.

The camera-gate component check covers permission request-on-entry, grant,
requestable denial, blocked denial, and web bypass. Native validation still
needs to confirm the OS prompt and Subscribe/Restore continuation on device.

The following important behaviors are present in code but are not obviously covered by the current documented E2E suite:

- conversation mode state machine
- native speech recognition failures and permission edge cases (the pure recovery policy is covered by `test:voice-errors`; the native paths still need device validation)
- TTS playback behavior and the completion watchdog
- notification initialization and background monitoring
- session fork and revert/unrevert
- attachment upload behavior
- attachment capability rejection and the 10 MB local-file limit
- project patch conflict UI and worktree remove
- MCP add/connect/disconnect and OAuth UI completion
- terminal reconnect/termination, ANSI handling, scrollback truncation, and native WebSocket behavior
- auto-approve preference toggling
- model enablement filtering and preference reconciliation
- session summarization fallback behavior
- keep-awake side effects
- working-sound busy/idle transitions
- native SSE transport behavior and real cellular reconnect timing (web missed-event recovery, deterministic backoff, injected 4G latency, and offline queue recovery are covered)

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
npm run test:vitest
npm run test:fake-server:self
npm run test:e2e:web
npm run validate:fast
npm run test:e2e:smoke
npm run test:e2e:web:isolated
npm run build:development:android
```

To debug the fake backend directly:

```bash
npm run test:fake-server
```

## Reimplementation Validation Recommendation

If the app is ever rewritten, parity should be judged at minimum against these behaviors:

1. hydration -> connect -> project discovery -> session bootstrap
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

The fake server self-test covers the expanded REST contract plus a real ticket-authenticated PTY WebSocket exchange. Playwright covers patch save, worktree creation, MCP addition, and interactive xterm behavior including history, modifiers, Unicode, alternate screens, bracketed paste and cursor resume. It does not prove real full-screen program compatibility, native WebSocket behavior, MCP OAuth UI completion, attachment capability, provider OAuth callback, or native reconnect behavior.

Android native validation happens on every CI run in the tagged/`main`/manual `android-release` job in `.github/workflows/build.yml`; there is no separate push-time Android development build gate.

## Assessment Validation Limits

These checks establish behavior and bounded request counts, not native frame
rate, launch latency, battery use, or memory. Terminal output uses ordered imperative batches with renderer acknowledgements,
a 2 MiB pending queue, and 10,000-line xterm scrollback. Sustained-output device
profiling is still required to establish frame rate and memory use. Physical-device
voice, background notification, and virtualized-list scrolling/accessibility checks
remain necessary. Changes under `tests/e2e/` or `tests/fake-opencode/` require
explicit human validation as specified by `AGENTS.md`, even after all automated
gates pass.

## UX simplification validation

The existing Playwright flows now cover direct approval and mode controls, thinking-slider adjustment in the model picker, draft retention, picker dismissal, settings updates, unsupported approvals, model-first names, starter draft selection, library search-empty copy, immediate changed-file opening, deleted content explanation, search failure recovery, completion overlays, patch-to-turn review, approval scopes, question descriptions, and setup's single action. The onboarding-skip flow now expects the connection recovery panel and its Open settings action.

The UX recovery work adds Vitest coverage for cold transcript read failures (including silent failures, retry clearing, and client replacement), the transcript retry card, the jump-to-latest affordance, and share target loading/expiry. The full static, fake-server, and web E2E gates pass. The onboarding E2E contract change was explicitly approved before editing. Native permission-denial settings handoff, terminal picker/copy feedback, snackbars, and screen-reader announcements still need physical-device validation. The fake completion message now includes its existing parent user message ID to cover review navigation. File-state/error edge cases use browser route overrides. Both test and fake-server edits require human validation.

Before committing this change, run the static, fake-server and full web gates. Native manual checks must cover iOS light/dark, regular/slim, larger text, keyboard visibility, pending blockers, VoiceOver action names/slider adjustment/focus, and Android hardware/soft keyboard Back behavior. Test edits require explicit human validation under AGENTS.md. Automated browser checks do not replace these native checks.

The composer approval toggle is now the sole Chat approval affordance: the shield represents asking, the warning represents auto-approval, and unsupported V2 servers omit the control. The adjacent agent icon opens the existing selector. Thinking is adjusted through the shared Settings slider at the top of the model picker. The composer flow covers direct approval failure/retry, agent selection, thinking keyboard adjustment, draft retention and picker dismissal.

## Add connection redesign validation

Manual setup now probes address → details in Settings and onboarding. Vitest
connection protocol/form coverage checks V1/V2 detection, auth uncertainty,
incorrect credentials, unknown/unreachable responses, proxy prefixes,
cancellation/stale results, native-only scan presentation, QR formats, malformed
payloads, expiry, loopback filtering, address order/timeouts and retry with a
redeemed token. Provider runtime coverage checks hostname defaults, unchanged
active connections, credential ordering/rollback and stable callbacks.
`manual-connection.spec.mjs` covers protected V1/V2 setup, optional/custom naming
and field preservation. Existing onboarding/connection flows cover duplicate
submission, edit behavior and connection retry without duplicate profiles. The V2
fake server supports protected discovery and one-use/expired pairing fixtures.

Run `test:ci:static`, `test:fake-server:self`, `test:e2e:web` and
`build:development:android`. Explicit human validation of modified E2E/fake-server
files is required by AGENTS.md. Real-device acceptance must verify `opencode pair`
scanning and automatic connection, camera denial, backgrounding, keyboard/Back,
larger text and screen-reader accessibility. Automated web tests cannot exercise
the native camera or confirm local-network reachability on physical devices.

Local implementation validation on 2026-10-09 passed the static suite (146 Vitest
cases plus the existing Node checks), both fake-server self-tests and all 104 web
E2E cases. The new connection-retry regression also passed three consecutive runs.
The Android development command completed Expo prebuild but
Gradle stopped with `SDK location not found`; no Android SDK is installed or
configured on this host. Real-device checks and explicit human validation of the
E2E/fake-server changes remain outstanding.

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

## Overlay swipe dismissal

The shared `OverlaySheet` and the transparent `Modal` bottom sheets (model picker, select pickers) dismiss on a downward drag of their header using `react-native-gesture-handler`, driven by `Gesture.Pan` and a Reanimated `translateY` shared through `components/ui/use-swipe-dismiss.ts`. The modal sheets wrap their content in `GestureHandlerRootView` so the gesture is recognized inside the native `Modal` window. The helper resets its drag offset when a sheet opens, never when it closes: on iOS the native `Modal` keeps its children mounted through the dismissal animation, so a close-time reset snaps the dragged-off sheet back on-screen (a ghost). A web flow opens the chat library and drags its header down to assert dismissal, and a sibling flow does the same for the model picker; the existing close-button flows still cover the tap path. Pull-to-refresh was removed from the project, transcript, and diff views, so their manual refresh coverage moved to the project header button and to SSE/polling. Run `test:ci:static`, `test:fake-server:self`, and `test:e2e:web`. Native acceptance must verify the drag on a real device (gesture-handler is a native module), especially inside the `Modal` sheets, plus screen-reader reachability and Android Back dismissal. E2E and fake-server edits require explicit human validation under AGENTS.md.


## Session library recovery (#64)

Session reads exclude archived records and paginate active-only pages. Archived sessions have no V2 equivalent and are not surfaced in the app. Web flows cover idle-session reopening, double taps, and cross-project restoration with failure/retry. Run `test:ci:static`, `test:fake-server:self`, and `test:e2e:web`. TestFlight validation with OpenCode 1.18.34, card taps, swipe actions, and accessibility remains required. Changes in the fake-server and E2E directories require explicit human validation under AGENTS.md.


## Cross-project favorite CI regression

The favorite flow waits for server-side prompt completion and the selected project rather than a fixed delay. It targets the favorite row directly, since the same session may also appear in the Active group. Provider runtime coverage reproduces cache pruning while bootstrap reads have arrived but capability discovery is still pending. Pruning waits for bootstrap completion and protects the pending deep-link target, then resumes with the selected, running, and conversation sessions. Validate with Node 22 and `CI=true EXPO_PUBLIC_E2E_MODE=1`, including repeated focused favorite flows and the full three CI gates. E2E changes still require explicit human validation under AGENTS.md.

## xterm terminal validation

Provider runtime tests cover stale terminal lists, scope changes with reused PTY
IDs, failed termination retaining the display, selection after closing, and disposal.
The Vitest terminal suite checks modifier/function-key encoding, system input
without keyboard/composition duplication, paste confirmation,
fragmented UTF-8, delayed Blob ordering, cursor barriers, pending-buffer overflow,
acknowledged UTF-16 resume positions, renderer loss, fresh tickets, authentication
failure, background suspension, resize debounce, and disposal during ticket acquisition.
The shared fake PTY supports incremental echo, history, Ctrl+C, alternate-screen
output, recorded input/resize/cursors, and deterministic disconnect/output/exit/
termination-failure controls. Both web protocol flows exercise these behaviors.

Run static CI, fake-server self-tests, full web E2E, FOSS preparation checks, native
DOM exports, Android development/release/FOSS builds, and an iOS simulator build.
Any unavailable native build prerequisites must be reported, not treated as passing.

Human validation is required for changes in `tests/e2e/` and `tests/fake-opencode/`
under AGENTS.md. Device acceptance must cover iOS, Gboard, Samsung Keyboard,
Bluetooth modifiers/function keys, composition and Unicode, multiline/bracketed
paste, selection/copy/scrollback, keyboard visibility, rotation, larger text,
VoiceOver/TalkBack, tab continuity, background reconnect, and real vim/less/top/tmux
sessions against both server contracts. Emulator output is not persisted across app kill.

Implementation validation (2026-10-08): static CI (76 Vitest tests plus the script
suites), fake-server self-tests, all 96 web flows, FOSS checks, offline iOS/Android
DOM exports, and an iOS simulator native build passed. The iOS simulator rendered
xterm, exchanged incremental keyboard input/output, and reported measured PTY
dimensions through the native bridge. Android development build stopped because
the Android SDK is absent; release/FOSS APK builds remain unverified for the same
reason. Physical keyboard/IME/accessibility and sustained-output profiling remain
manual acceptance work. The unsigned simulator build also emits existing
notifications/SecureStore keychain entitlement warnings.

## Scoped Project browser validation

Both fake contracts now require scope on filesystem find/list/read, return distinct
content for projects and worktrees, and retain owning project identity for
worktree directories outside the main checkout. Self-tests exercise the installed
V2 SDK's filesystem and worktree operations, raw binary reads, and the V1
empty-binary response. Protocol tests cover safe relative paths, folder-first
sorting, directory-only inventory, MIME/kind normalization, preview-size bounds,
V1 limitations and authenticated download URLs. Provider runtime tests cover
competing directory/search requests and switching servers with identical paths.
Web flows cover initial folder lists, breadcrumbs, search across subfolders,
preview/back, V2 image preview and download, document download, V1 binary
unavailability, capability-gated editing, worktree selection/reload/removal,
Terminal/Chat continuity, discard confirmation and recoverable save conflicts.
Native acceptance still covers audio/video playback, the OS save/share sheet,
large streaming downloads, cache cleanup, background/close behavior and
screen-reader actions.

Run `test:ci:static`, `test:fake-server:self`, `test:e2e:web` and the Android
development build. Check physical-device Back/keyboard behavior, safe areas, larger
text, screen-reader names, light/dark and slim layouts. Changes to fake-server and
E2E files require explicit human validation under AGENTS.md.

Implementation verification on 2026-10-08: `test:ci:static`, both fake-server
self-tests, and all 99 web E2E tests passed. Additional browser checks covered
390×844 dark/slim and 1440×1000 light layouts, keyboard search, full-screen preview
return and picker bounds, with no uncaught browser errors. The Android development
build stopped because no Android SDK location was configured. Native keyboard,
Back, safe areas, large text, screen-reader behavior and real-server acceptance
remain to be checked; explicit human validation of the changed test contracts is
still required.

## App update validation

`tests/vitest/app-updates.test.ts` covers cooldown, the enable toggle and check
period, store identity, numeric versions, TestFlight suppression, blockers,
cancellation, failure, timeouts and recovery.
`tests/e2e/app-updates.spec.mjs` exercises direct native consent without a themed
offer, the nonmodal ready banner, drafts and open sheets suppressing it, persisted
Later, cancellation, separate download/install actions, and explicit App Store
navigation using a development fixture. Mobile checks cover 390×844 dark and
320×700 light layouts, 44-point controls, usable tabs and an uncovered composer.
The provider tests also cover deferred native consent, enabled checks and a
version changing between discovery and native handoff. No fake server protocol is changed. Real Play/App Store and
accessibility acceptance remains required; see [app updates](app-updates.md).
E2E changes require explicit human validation under AGENTS.md.

Implementation verification on 2026-10-09: static CI, fake-server self-tests, all
112 web E2E flows, FOSS preparation, and actual Expo Android autolinking inclusion/
exclusion checks passed. The unsigned iOS device Release build passed, including
the production AppTransaction branch. The Android module compiled separately with
Kotlin 2.1.20 against Expo/RN and official Play 2.1.0 APIs; the full development
build stopped before app compilation because this host has no Android SDK.
Android APK/R8/FOSS artifact builds, real store/device acceptance and explicit
human validation of the added E2E contract remain outstanding. The missing iOS
App Store ID remains a configuration prerequisite. No version was increased.
The final 390×844 dark-layout update flows also passed, including 44-point banner
action targets and cross-tab draft protection.

Update-flow revision verification on 2026-10-11: static CI (including 166 Vitest
tests), both fake-server self-tests, all 115 web E2E flows and FOSS preparation
passed. Screenshot review caught a floating banner covering the composer; the
final banner occupies layout space above the default tab bar, and E2E checks
verify the composer and tabs remain usable. The selected concept's colors, copy,
12-point banner radius and mint action are retained; controls wrap into a second
row on narrow screens using existing Paper typography. Android development
prebuild succeeded, but Gradle stopped because no Android SDK is configured.
The user explicitly validated the revised E2E behavior contract on 2026-10-11.
Real store installation and native accessibility/large text acceptance remain
outstanding. No version was increased.

## OpenCode 2 primary protocol inversion

`@opencode/client` is the primary SDK, client contract and fake backend. Default construction, uncertain detection and PTY URLs use v2; affirmative v1 discovery selects the isolated compatibility implementation. Alternate-contract attempts require an actual endpoint/protocol mismatch, never auth denial or transport failure. Production v1 SDK imports are prohibited outside `lib/opencode/compat/v1/` by the architecture suite.

Playwright boots native `server.mjs` on 44096 and explicit `server-v1.mjs` compatibility on 44097. Shared prompt/approval/question/polling and persisted continuity flows run on v2 with additional v1 coverage. Compatibility-only patch saves remain covered. The self-test exercises both protocol contracts plus shared terminal infrastructure.

Focused regressions cover native message cursors/events, replay/update-safe usage and todos, same-directory connection switching, persisted session continuity, conflict rejection, write failure/draft retention, post-write verification, MCP integration discovery, automatic/code completion and cancellation while requests are in flight.

Required gates remain `test:ci:static`, `test:fake-server:self`, `test:e2e:web`. Android development validation and real-server/device checks for file edits, OAuth, reconnects and terminals are required acceptance checks. On this host Expo Android prebuild succeeds, but Gradle cannot compile without an Android SDK; the local server requires authentication. These are outstanding checks, not passing results. Changed fake-server/E2E contracts require explicit human validation before completion.

Background v2 completion also checks native inbox, permission/form blockers and the latest retry record before notifying; an unavailable read keeps monitoring pending. Worktree regressions distinguish the owning canonical project from the selected worktree location.

### Human acceptance for the v2 primary change

Automated validation: static CI checks and both fake-server self-tests pass; the complete Playwright suite passes 126 tests. Android prebuild passes, but development compilation is blocked by the missing SDK. Authenticated real-server/device validation remains outstanding; the user will perform these checks manually after the changes are committed.

Before marking this change complete, a human must review and validate the changed `tests/fake-opencode/` and `tests/e2e/` contracts (AGENTS.md):

- Confirm native fixtures and cursor/event/form/permission behavior match v2; inspect the explicit v1 translations and compatibility-only scenarios.
- Exercise prompt completion, questions/approvals, reconnect/polling recovery, persisted sessions and worktree switching on both contracts.
- On a real v2 server/device, edit UTF-8 text, reject an external edit conflict, retain a failed-save draft, and verify saved content/VCS refresh. The pre-read/write race remains accepted.
- Complete automatic and code MCP OAuth, cancel/restart, and switch connections while authorization is pending.
- Verify terminal streaming and cursor resume after reconnect; V1 keeps only V2-parity features.

No dependency version, persisted schema or release version was changed. Existing Cloud Link work is retained.

## Cloud Link illustrated onboarding

`connect-onboarding.test.ts` checks four-step navigation, explicit scan before
camera permission, denial returning to Pair, pending/canceled purchases,
finalization-error recovery, subscriber entry, access loss and direct-link
continuation. The existing Cloud Link web suite now enters Subscribe through
Learn and Computer setup for ordinary entry, retaining deep-link purchase,
Restore, renewal, activation and error coverage. New flows assert native pricing,
copy feedback, removed Share setup, Restore above Subscribe, aligned illustration/
heading/subheading/primary-action positions, explicit checkout and no pairing
until scanning or opening a link. Pending and canceled guided purchases stay on
Subscribe. The fake backend and subscription protocol are unchanged.

Run all three CI gates and the Android development build. Native acceptance must
cover real App Store/Google Play purchase/Restore, camera allow/deny and fallback,
desktop approval, Back/keyboard, foreground suspension, safe areas, light/dark,
larger text and VoiceOver/TalkBack. Modified `tests/e2e/connect.spec.mjs` requires
explicit human validation under AGENTS.md after automated checks pass.

Human validation: on 2026-10-13 the user explicitly validated the revised Cloud
Link E2E contract in this chat. Real store/camera/device acceptance remains
outstanding and is separate from approval of the deterministic test contract.

Implementation validation (2026-10-13): static CI passes (290 Vitest checks), both
fake-server self-tests pass, and the full web suite passes 134 flows. After the
short-screen illustration adjustment, all 44 Cloud Link flows pass again with
fresh dark and narrow-light captures. Browser comparison is recorded in
`design-qa.md`. Android development prebuild passes; Gradle remains blocked by
`SDK location not found`. No dependency, release version or protocol changed.

Pair illustration refinement (2026-10-13): the thick scanner icon is replaced
by a transparent, theme-tinted corner overlay positioned outside the display.
The original computer drawing is still shared with Download. Lint, typecheck and
both focused dark/narrow-light flows pass on isolated preview/backend ports; the
full suite and native build were not repeated for this visual-only change. The
user explicitly validated the screenshot-helper adjustment in this chat.

Pre-merge validation (2026-10-13): the Cloud Link commit was rebased onto `main`
without the unrelated Android-sharing commits from its original base. All three
required gates pass on that result: static CI (289 Vitest checks), both fake-server
self-tests, and all 134 web E2E flows, including the final scan-frame refinement.
Native builds and real store/camera/device acceptance were not repeated.

## Connector service management validation

A paired device adds, replaces and removes the connector's exposed services
through `/_cloudlink/services` and reads the connector's management revision and
service port pool from `/_cloudlink/version`. Coverage is split by layer:

- `lib/opencode/client/management.ts` is unit-tested in
  `tests/vitest/services-management.test.ts`: the path/target/id validation
  mirror, the root/port rules and port-picker computation, both stored shapes
  (`path` string and `path` null) and both version responses (`api` 1 without a
  pool and `api` 2 with `service_ports`, plus `404` without a version header),
  the api 2 PUT body (root and path) and the legacy api 1 body without `port`,
  link building for root, path and legacy services, the device Basic credential
  and request shape, canonical-value parsing, and error/status propagation
  (including the no-connection and expired-credential guards).
- `tests/vitest/services-target.test.ts` covers the pure target resolution in
  `providers/services-target.ts`: the active Cloud Link connection, explicit
  selection of another saved machine, last-used fallback for a manual active
  connection, subscription-environment filtering, no-candidate handling, and the
  machine list's active marking.
- The V2 fake server implements `GET/PUT/DELETE /_cloudlink/services` and
  `GET /_cloudlink/version` behind a device-credential check provisioned through
  `POST /__control/device`, with `POST /__control/connector-api` switching the
  reported management revision. `tests/fake-opencode/self-test.mjs` asserts 401
  without a device credential, the api 2 version shape and header, 201 create /
  200 replace, canonical path/target responses, missing `port` and out-of-pool
  port rejection, duplicate port/path rejection, root-service port ownership and
  mixing rejection, shared path ports, 404 on unknown delete, list consistency,
  and the api 1 legacy version/body shapes.
- `tests/e2e/connect.spec.mjs` drives a real Cloud Link pairing, opens Settings →
  Services, and adds, edits and removes path and root services through the fake
  connector, including picking a port and seeing an occupied port marked. Add and
  Edit now enter the full-screen `app/service.tsx` route and return to the
  reopened Cloud Link section. A second flow switches to a manual connection and
  proves the saved machine's services stay listed with the not-active notice.

The connector contract is frozen and unchanged; this change is app-side target
resolution plus the reworked flows, so the E2E additions require explicit human
validation under AGENTS.md. CI gates: `test:ci:static`, `test:fake-server:self`,
`test:e2e:web`.

## Extended onboarding acceptance

Onboarding navigation/model unit checks cover both visible sequences and shared
configured/enabled model filtering. Web flows cover embedded provider auth/model
toggles, remembered-model selection and Chat continuity, preference persistence,
immediate language changes, interrupted setup, V1 delivery hiding, empty model
catalogs, provider removal/reconciliation, back navigation and Settings review.
Fresh-install Cloud Link pairing must continue to AI before Project. No fake
server contract is changed. Run the static, fake-server and full web CI gates.
Changed E2E contracts require explicit human validation under AGENTS.md; accepting
the design mocks does not validate those test changes. Native acceptance must
cover picker dismissal, Android Back, reconnecting provider sign-in, safe areas,
light/dark themes, larger text and screen-reader names.

Manual-connection regressions now expect AI immediately after a successful
connection. The latest-turn diff assertion allows the documented five-second
fallback after completion text; it keeps the same file assertions without a
fixed delay. Screenshot flows wait for picker dismissal before capturing General
and Review so a closing modal cannot obscure the evidence.

Implementation validation (2026-10-20): all three CI-equivalent gates pass:
static checks (77 Vitest files / 452 checks), both fake-server self-tests, and all
148 web E2E flows. The latest-turn diff flow also passed five consecutive runs.
The Android development build passed (876 Gradle tasks), using the existing
locked dependencies in a local mirror; source edits stayed in the project root.
Browser and screenshot review covered 390×844 dark and 320×700 light layouts,
model selection, Back navigation, wrapping and pinned footers. Browser logs had
only existing React Native web warnings, with no app errors. The i18n registry was
regenerated in the project root and passes parity checks for all eight languages.
Physical-device Back, larger text, screen readers and real provider OAuth remain
unverified. Human validation of the four changed E2E specifications remains
required under AGENTS.md; no fake-server source, dependency, release version,
persisted schema or onboarding completion version changed.

## Multi-server V2 regression coverage

`tests/e2e/multi-server.spec.mjs` starts two independent V2 fakes with intentionally colliding chat IDs and project paths. It checks the mixed list and filters, draft isolation and connected-set restoration, chat and PTY creation on a chosen server, renderer continuity through disconnect/reconnect, Settings/auto-approve isolation, replies to colliding approval IDs on the correct server, long-title server-chip containment, and the in-flight row indicator during a cross-server open. The cross-server open flow also holds the target server's session reads to prove the library closes immediately and the chat shows its transcript skeleton until hydration completes. New chat and terminal tests confirm the explicit creation sheets, including the disabled confirm state until a project is selected.

`tests/vitest/workspaces.test.ts` covers composite catalog ordering, shared SSE teardown, secret-free registry validation, last-project closure/projection, single-owner active-session reads, and hidden-draft update blocking and removal cleanup. The native notification boundary also combines server counts and keeps other servers visible during disconnect. Existing connection recovery, prompt/draft races, sharing, transcript and architecture tests remain required. Share coverage includes a confirmed cross-server destination while focus changes.

Run `npm run test:ci:static`, `npm run test:fake-server:self` and `npm run test:e2e:web`. For manual review, use two independently running V2 fakes, open Connections to connect both, then inspect Chats, Projects, the New terminal sheet and each Settings server selector. Test both themes and slim mode. Browser tests do not establish native WebView retention, microphone ownership, notification delivery or OS background limits; verify those on Android/iOS hardware before release.

For a seeded human-review environment, run `npm run preview:workspaces`. It builds a development web export, starts two isolated V2 fake servers and prints a `/demo.html` URL. That entry point seeds named connections and colliding chat IDs; ordinary reloads preserve subsequent choices. Its reset link clears only that preview origin's app state. Ctrl+C stops all three owned processes.

The preview includes two projects on each server and a subagent fork on Build server. Send a prompt on MacBook Pro to see a normal completion; send one on Build server to exercise a permission request and its server-scoped Approvals view. Switch Hide subagents off to expose the fork. Create a terminal on Build server/secondary-project while keeping chat on MacBook Pro/demo-project.

Terminal selection uses one continuous list with a server chip on each row, without empty workspace headings. With one configured workspace connection, server filters, selectors, chips and redundant scope labels are hidden across Chat, Projects, Terminal and Settings, including the New chat and New terminal server pickers; both Settings section headings, project context and connection management remain available. Disconnected connections still count, so cached rows keep their ownership visible. Multi-server controls return automatically when a second connection is added.

## Dictation accumulation (#77)

`tests/vitest/transcript-accumulate.test.ts` covers Unicode (Cyrillic, CJK, Arabic,
Devanagari, Korean and combining marks), shorter interim/final corrections,
intentional repetitions, consecutive identical finals, empty results, restart
checkpoints and turn resets. `tests/vitest/speech-input.test.ts` drives the real
speech hook with deterministic native events: only the initiating owner receives
results, an interim survives the on-device to network fallback, stop drains final
results, and unmount cancels the active owner's recognition. Competing starts
are rejected both while listening and during a pending network retry; ownership
can move after the prior session ends without leaving its composer locked.
Cancellation tests defer the native end, attempt both competing and same-owner
starts, deliver delayed canceled events, and verify terminal cleanup after
unmount. A deferred retry permission request is stopped and then resolved to
prove it neither starts recognition nor retains the reservation. Each speech
hook aborts its own recognition on backgrounding; inactive hooks cannot stop
the active owner, and repeated cleanup does not queue duplicate native ends.
An iOS pending permission request survives an `inactive` alert and granted
permission. Provider coverage backgrounds both interim-only and finalized unsent
turns, delivers native end, and verifies no restart or delayed submission.

`tests/vitest/provider-runtime.test.ts` exercises conversation restarts with and
without finals, multiple multilingual sessions, consecutive segments, speech onset
and unfinished interims canceling submission, late events after cancellation,
and a clean subsequent turn. Run `test:ci:static`, `test:fake-server:self`,
`test:e2e:web` and `build:development:android`. No E2E/fake-server source changes
are needed relative to main. Real Android/iOS microphone timing and recognition
quality require device testing; deterministic event tests do not establish them.

## Code-block copy haptic validation

`tests/vitest/chat-markdown.test.ts` invokes the native code-block copy callback
and asserts one haptic acknowledgement. `tests/vitest/haptics.test.ts` asserts
that the shared helper uses the same success notification as message copy.
Copy state, Snackbars and i18n are unchanged. Run `test:ci:static`,
`test:fake-server:self`, `test:e2e:web` and `build:development:android`. On
Android, tap the header copy button and the long-press "Copy" action on a fenced
block: the clipboard matches and the same haptic as message copy fires without
the message bubble's Copied pill or border. "Copy as Markdown" does not emit
`onCopyPress`, so it has no haptic. Native haptics remain device- and
system-setting-dependent.

## Dark-mode markdown readability validation

`tests/vitest/chat-markdown.test.ts` also asserts the renderer receives an opaque
code-block background from the supplied palette, the matching syntax palette,
and a transparent blockquote background. Run `test:ci:static`,
`test:fake-server:self`, `test:e2e:web` and `build:development:android`.

On Android, in both light and dark themes, send an agent message containing a
plain fence at the root, a plain fence inside a blockquote, a plain fence inside
a list, and a language-tagged fence. Also send a user message containing a plain
fence, then repeat with the flat transcript preference enabled. Verify the code
text contrasts with its background, no light block sits behind the code,
blockquote text stays readable, and code-block copy still fires the light
haptic. Native rendering cannot be established by the Vitest style assertions
alone.
