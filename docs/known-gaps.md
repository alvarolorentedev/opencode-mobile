# Known Gaps

Deliberately deferred work, with enough context to pick each item up safely.
These are known structural limits, not bugs. Fixing them changes shape rather
than behavior, so they should land one at a time with the usual validation.

Any change here that touches `tests/e2e/` or `tests/fake-opencode/` still
requires explicit human validation under `AGENTS.md`.

## 1. Provider and chat orchestration wiring

Closed on 2026-10-18. The coupling hotspot was split without changing behavior:

- `providers/opencode-provider.tsx` is now a thin wrapper (~33 lines). The
  domain hooks and their input spreads moved to
  `providers/use-opencode-provider-composition.ts` (~410 lines), and the
  context-provider tree moved to `providers/opencode-provider-tree.tsx`.
- The provider line ratchet in `tests/vitest/architecture.test.ts` dropped from
  500 to 60 in the same change, so the entrypoint cannot regrow into a god
  object. The repo-wide 500-line ceiling still covers both new files.
- `components/chat/chat-view.tsx` renders `TranscriptList`, `ChangesOverlay`,
  and `PendingInteractions` directly; the `ChatContent` pass-through
  (`components/chat/chat-content.tsx` and its barrel) is gone.
- `useChatViewController` returns `header` / `content` / `composer` / `overlay`
  / `actions` namespaces instead of ~85 flat members, and `ChatView` consumes
  those namespaces directly.

Remaining deferred piece: a selector-based subscription model. The workspace
root now memoizes each overridden domain independently, exposes stable chat
actions separately from the snapshot registry, and memoizes runtime components,
so background publishes no longer invalidate unrelated domains. A selector-based
model remains deferred until profiling shows the remaining context fan-out is
material.

## 2. Test infrastructure leftovers

Partially closed on 2026-10-18:

- **The Playwright specs are split.** The former ~2,300-line
  `tests/e2e/flows.spec.mjs` is now domain specs (`chat`, `interactions`,
  `diffs`, `projects`, `sessions`, `realtime`, `settings`, `terminal`, `v2`,
  `compat`) sharing `tests/e2e/helpers/flows.mjs`. `onboarding.spec.mjs` and
  `plan-overlay-probe.spec.mjs` reuse the same helpers instead of duplicating
  them. Test titles are unchanged.
- **The Vitest suites are type-checked with a denylist.** `tsconfig.tests.json`
  type-checks `tests/vitest`; `npm run typecheck:tests` (part of
  `test:ci:static`) runs it. The 23 suites that still drive the dynamic
  `loadTs` / `hookRuntime` harness with untyped module shapes are listed under
  `exclude`. Shrink that list as suites are cleaned up; do not add to it without
  a note here.
- **`tests/foss-prepare.test.mjs`** stays a standalone Node script
  (`npm run test:foss`, run by the `foss-release` CI job). It mutates a
  temporary `node_modules` tree and is build tooling rather than app behavior,
  so it is deliberately not part of the Vitest include.

## 3. CI duplication and observability

Closed on 2026-10-18 except for the remote reporter:

- **Duplicated `validate` job.** `pr-validate.yml`, `build.yml`, and
  `ios-release.yml` now call `.github/workflows/validate.yml`
  (`workflow_call`). `ios-release.yml` keeps tag resolution in its own
  `resolve-tag` job and passes the ref into the reusable workflow.
- **Local crash diagnostics are surfaced.** `lib/error-reporting.ts` gained
  `readLastJsError()`, `hooks/use-last-js-error.ts` owns the read lifecycle, and
  Settings → Diagnostics shows the last recorded JS error (message, time, and a
  fatal/handled chip) or a neutral empty state. The Refresh action re-reads it.
- **No remote crash/error reporting.** Still deferred. An opt-in reporter (for
  example Sentry) would need a dependency, a consent toggle behind the existing
  diagnostics surface, and scrubbing that never sends the server URL or
  credentials. Only worth doing if a remote pipeline is explicitly funded.

## 3b. Offline outbox and native 4G validation

The queued-prompt path introduced on 2026-10-23 is intentionally
process-lifetime. It covers a drop during an active turn and prevents duplicate
admission after a lost response. It does not send after the app is killed, and
it does not persist prepared attachment data URLs (the composer draft remains
the durable copy). A true persistent outbox would need an attachment spool,
encryption/at-rest policy, and an explicit send-on-reconnect setting.

Web E2E covers injected 4G latency, offline→online queue recovery, and the
deterministic SSE/polling paths. Native behavior still needs physical-device
validation on real carrier 4G, Wi-Fi↔cellular handoff, long idle/NAT expiry,
Android data saver/background restrictions, and iOS background suspension.
Adding NetInfo and expo-image-manipulator also requires a native build/device
smoke test before release.

## 4. Transcript merge micro-optimizations

Deferred on 2026-10-18 while the transcript refresh policy was simplified
(single tail-merge, 300-record window with a 10-entry display target, no
backward bridging). The remaining
render-cost machinery is intentionally untouched because it is not the source of
the stale/empty-transcript behavior and is harder to validate:

- `mergeSessionMessageWindow` / `prependSessionMessageHistory` keep record object
  references and use `JSON.stringify` equality so unchanged records skip the
  tokenization pass (`lib/opencode/format/window.ts`).
- `toTranscriptEntry` caches entries in a `WeakMap` keyed by record reference.
- `TranscriptList` re-asserts the FlashList tail across several frames
  (`TAIL_SETTLE_FRAMES`) and restores offset on focus/foreground.

Revisit only with render profiling evidence, and one mechanism at a time.

## 5. V2 non-message timeline records

Deferred on 2026-10-19 with the verbosity levels
(`basic`/`reasoning`/`verbose`). The V2 timeline also carries `idle`, `system`,
`synthetic`, `skill`, `shell`, `agent-switched`, `model-switched`, and
`location-switched` records. They are fetched but not rendered at any current
level; most are mapped to empty non-display records. A future "everything/debug"
level would map them into transcript details (and would need to decide how to
present shell output and skill/system text).

## 6. Gateway headers on direct file reads and browser WebSockets

Closed for the OpenCode data plane on 2026-10-23: per-connection custom headers
are sent on probes, REST, SSE, terminal connect-token requests and native
terminal WebSocket upgrades, and values live in SecureStore. Two direct paths
remain outside that guarantee by design:

- **Attachment previews.** `lib/attachment-preview.ts` fetches attachment `uri`
  values directly, and those URLs may be arbitrary hosts. Attaching a
  connection's gateway headers there could leak service-token secrets to a third
  party, so previews stay header-free until the app can restrict them to the
  exact server origin. Server-hosted attachments behind Access will fail to
  preview/open.
- **WebSocket upgrades on web.** Browser `WebSocket` has no API for custom
  headers. The terminal still authenticates its ticket request over HTTP with
  the connection's headers; only the upgrade is header-free. Native builds send
  the full header set. Web is limited to the development/E2E harness and has no
  credential persistence, so this is not a production path.

Cloud Link profiles and `opencode pair` QR codes cannot carry custom headers;
the editor is manual-only. Supporting them would require a control-plane/QR
contract change, not app-side plumbing.
