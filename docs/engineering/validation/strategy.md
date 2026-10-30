# Validation Strategy

This repo validates behavior with static checks, Vitest contract suites, a
deterministic fake OpenCode server, and Playwright flows. It deliberately does
not chase broad unit-test coverage.

Back to the [validation index](../testing-and-validation.md) · [engineering index](../README.md).

## Start here

| Change | Minimum validation |
| --- | --- |
| Docs, ADRs, Storybook catalog wiring | `npm run test:docs` |
| UI copy or translations | `npm run gen:i18n`, strict i18n test |
| Presentational component or story | `npm run build:storybook` |
| Provider/session/persistence logic | targeted Vitest, then fake server/E2E if the contract moved |
| Protocol, endpoint, or event | `npm run test:fake-server:self`, targeted E2E |
| User flow, blocking interaction, SSE, polling | `npm run test:e2e:web` |
| Native module, keyboard, permissions, release config | `npm run build:development:android` plus device checks |

Baseline before push: `npm run test:ci:static`, `npm run test:fake-server:self`,
`npm run test:e2e:budget`, `npm run build:storybook`, and `npm run test:e2e:web`.

## Test selection matrix

Pick the cheapest level that can detect the regression. Extend an existing
scenario before adding a new spec; see [ADR 0010](../../adr/0010-risk-based-validation-and-selective-pr-e2e.md).

| Change | Preferred test level | PR E2E |
| --- | --- | --- |
| Docs, ADRs, repository Markdown | docs test + static | none |
| Translations | strict i18n test + static | smoke |
| Pure utility, parser, formatter, selector | targeted Vitest | none or affected spec |
| Presentational component or design token | Storybook + static + affected spec | smoke + affected spec |
| Settings section or row | Storybook + `settings.spec.mjs` | smoke + settings |
| Chat, composer, transcript | `chat`, `interactions`, `diffs` specs | smoke + affected specs |
| Provider, session, persistence | Vitest integration + affected E2E | full |
| Protocol, endpoint, event, service adapter | fake-server self-test + contract Vitest + E2E | full |
| SSE, polling, reconnect, offline | deterministic Vitest + `realtime`/`network-resilience` | full |
| Fake server or E2E infrastructure | self-test + full E2E + human validation | full |
| Native voice, notifications, permissions, widgets | existing targeted tests + device checklist | smoke + manual |
| Dependencies, app config, build/CI config | static + full E2E | full |
| Release tag | exact-SHA full validation + native builds from the green `Build` run | n/a |

Escalate to the full suite when the change touches `providers/`,
`lib/opencode/`, `providers/services/`, `tests/fake-opencode/`, `tests/e2e/`,
dependencies, app/build configuration, workflows, a root layout, or more than
two domains. An unmapped path also means full.

No new test is required for documentation-only changes, behavior-preserving
refactors with existing coverage, generated files, or copy covered by locale
parity and an existing flow. Agents must explain why existing coverage is
sufficient in the PR verification section.

## Documentation and catalog checks

`tests/vitest/docs.test.ts` (`npm run test:docs`) enforces the documentation
contract: every doc is reachable from a section README, relative links and
anchors resolve, inline repository paths and `npm run` scripts exist, ADR
numbering/structure/index are current, the task routing surface and split
indexes are wired, and the Storybook catalog is present. It runs as part of
`test:ci:static`.

`npm run build:storybook` builds the web catalog for reusable presentation
components. It is not part of the app or E2E export. See
[Storybook](../../design/storybook.md).

## Validation cost and fast paths

The browser flows dominate the gate. Static checks are the fast inner loop.

- static checks: roughly 15s warm and 45s cold locally; lint, app and test
  type-checking, and Vitest
- fake-server self-test: a few seconds
- Storybook catalog build: a few seconds; it is a static web build, not part of
  the app or E2E export
- full Playwright gate: several minutes in CI, dominated by browser execution

For local iteration:

```bash
# Once, to produce the URL-agnostic export
npm run build:web:e2e

# Terminal 1: serve the existing export without rebuilding
npm run serve:web:prebuilt

# Terminal 2: run only the spec you changed
npx playwright test tests/e2e/chat.spec.mjs
npm run test:e2e:smoke          # critical flows
npm run test:e2e:last-failed    # rerun the previous failures
npm run test:e2e:changed        # smoke + specs selected from the current diff
npm run test:e2e:budget         # check the expanded test/spec budget
```

Concurrent local runs must not share fixed ports. Use the isolated wrapper:

```bash
npm run test:e2e:web:isolated -- tests/e2e/realtime.spec.mjs
E2E_SKIP_BUILD=1 npm run test:e2e:web:isolated -- tests/e2e/realtime.spec.mjs
```

Workers default to 2 locally and 4 in CI. Override with `E2E_WORKERS`.
`npm run validate:fast` is the pre-push loop (static, fake-server self-test,
E2E budget, and the smoke set); the full `test:e2e:web` gate is still required
on the main commit before a release tag can reuse it.

## CI gates

`validate.yml` is the single reusable gate (`workflow_call`). Three callers
use it:

- `build.yml` — pushes to `main`, plus a `force_validate` dispatch for emergency
  full validation
- `pr-validate.yml` — pull requests targeting `main`
- `ios-release.yml` — manual iOS release dispatch

`release.yml` does not call the gate. It is triggered by a green `Build` run on
`main` and verifies that exact SHA before creating a tag-backed release; a
manual dispatch still requires an existing successful full validation.

The gate classifies changed paths first, then runs:

1. `npm run test:ci:static` — lint, app and test type-checking, and Vitest.
   `package.json` is the source of truth for the exact suite list.
2. `npm run test:fake-server:self`
3. `npm run build:storybook` when UI or Storybook files changed.
4. E2E:
   - PRs: smoke plus the affected specs, or the full suite for shared or
     unmapped paths.
   - `main`: the full suite for code-bearing pushes; docs-only pushes skip E2E.
   - release tags: no rerun; the tag must point at a successful full `main`
     validation.

The E2E job also runs `npm run test:e2e:budget` before launching a browser. Its
failure message asks for extending an existing scenario or an explicit budget
update.

Use `validate / gate` as the required branch-protection check. It accepts a
skipped E2E job only when the selector chose no E2E; a failed or cancelled job
still fails.

`build.yml` also owns Android release jobs and runs `npm run test:foss` for the
FOSS variant. Android and FOSS builds run in parallel after the gate, and a
release-preparation job creates the GitHub Release once before both uploads.
`ios-release.yml` validates, builds, signs, and optionally uploads the iOS
archive. Release artifacts expire; the permanent copy is the GitHub Release
asset or store upload.

## What automated checks do not prove

Web checks do not establish native frame rate, launch latency, battery use,
memory, physical-device keyboard behavior, camera or microphone permission
flows, screen-reader acceptance, real App Store/Play purchases, or full-screen
terminal compatibility. Use [voice validation](../voice-validation.md) for
voice-device checks and [known gaps](../known-gaps.md) for deferred work.
Changes under `tests/e2e/` or `tests/fake-opencode/` require explicit human
validation even when every automated check passes.

## Coverage gaps

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

Cloud Link subscription checks are described in [connect.md](../../product/cloud-link.md). Provider
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
- native TTS playback, on-device model install/prefetch, and the completion watchdog
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

## Practical validation commands

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

## Test suite map

| Layer | Location | Purpose |
| --- | --- | --- |
| Vitest | `tests/vitest/` | Contract, provider, persistence, formatting, i18n, docs, architecture |
| Fake server | `tests/fake-opencode/` | Deterministic V1/V2 HTTP, SSE, PTY, and scenario fixtures |
| E2E | `tests/e2e/` | Playwright flows over the fake server |
| Native | `tests/native/` | Native-specific checks and fixtures |
