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
- **The Vitest suites are fully type-checked.** `tsconfig.tests.json`
  type-checks every file under `tests/vitest`; `npm run typecheck:tests` (part of
  `test:ci:static`) runs it. The dynamic `loadTs` / `hookRuntime` harness is
  described by `tests/helpers/runtime.d.mts`, so suites can use it without
  weakening compilation. `tests/vitest/typecheck-ratchet.test.ts` prevents a
  denylist from returning.
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

## 3c. Playwright parallelism

Closed on 2026-10-23:

- CI runs the Playwright suite in one job with four workers alongside the
  static job. The web export is built and served once; each worker owns a fake
  V1/V2 server pair, so the fake server's single global scenario is never
  shared. The fixture selects the worker's backend URL at runtime.
- The browser download, `.eslintcache`, TypeScript build info and static-check
  inputs are cached.
- Local concurrent runs use `npm run test:e2e:web:isolated`, which reserves a
  contiguous fake-server port block and a fresh web port. `npm run
  test:e2e:smoke` runs the 17 tagged critical flows, and `npm run
  serve:web:prebuilt` reuses an existing export.

Still deferred: more workers than the runner has capacity for. The worker count
is configurable through `E2E_WORKERS` (2 locally, 4 in CI) so it can be reduced
without changing the workflow.

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
(single tail-merge, one 200-record initial window, no backward bridging). The remaining
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

Deferred on 2026-10-19. The fixed detailed transcript renders message, tool,
reasoning, patch, and shell activity. The V2 timeline also carries `idle`,
`system`, `synthetic`, `skill`, `agent-switched`, `model-switched`, and
`location-switched` records. They are fetched but not rendered; most map to
empty non-display records. A future non-message timeline renderer would map them
into transcript details (and would need to decide how to present skill/system
text).

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

## 7. V1 support policy

V1 is maintained only for the feature intersection with V2. V1-only surfaces
(sharing, archive/restore, title summarization, general config writes, persistent
MCP enablement, worktree reset, and LSP/formatter diagnostics) are intentionally
unsupported. Compatibility code stays behind `lib/opencode/compat/v1/` and the
provider service boundary; do not add new UI branches on `contract === 'v1'`.

Realtime timing and reconciliation helpers live under `providers/realtime/`.
Keep the dual SSE/polling model and preserve its timing contract when editing
them.

## 8. Conversation wake phrase limitations

The wake phrase is a submission gate over the existing OS recognizer, not a
dedicated wake-word engine. Consequences:

- the recognizer still streams while `armed`, so this does not reduce
  recognition cost, battery use or vendor audio traffic
- phrase detection accuracy follows the OS recognizer; contextual biasing and
  the configurable phrase mitigate but do not eliminate misses
- conversation mode stops when the app backgrounds, as it did before; the
  phrase is not an always-on background listener
- ambient speech that follows a correctly detected phrase is still treated as
  the command; the six-second command window bounds exposure but does not
  identify the speaker

## 9. Workspace readiness and render-time state

Two render-timing couplings remain in the workspace shell. They are not library
gaps; they are internal coordination issues worth fixing before the flows grow.

- **Workspace readiness polls React state.** `providers/use-workspace-connections.ts`
  uses `tick()` (a 25 ms `setTimeout`) inside `ensure()`, `connectedWorkspace()`,
  and `navigate()` to wait for a retained `WorkspaceRuntime` to publish its first
  snapshot. The wait is bounded at 20 seconds, but it couples navigation to render
  cadence and can spin while a runtime is suspended or a connection is slow.
  Replace it with a per-workspace readiness promise or a small event subscription
  that resolves when the runtime publishes or the workspace is removed. Do not
  add another shared store; the registry should remain the owner.
- **Connect pairing changes step during render.**
  `components/settings/connect-pairing.tsx` derives `step` from provider state,
  then calls `setStep(4)` or `setStep(3)` directly in the render body (the
  guided pairing transitions). This can produce React warnings and an extra
  render pass, and it makes the transition harder to test. Derive the visible
  step from provider state plus a local override, or move the adjustment into
  an effect with an explicit guard.

## 10. Extension management boundaries

Extensions are V2-only and edit server-side config files because the native API
has no durable config/plugin/skill/command mutation surface. Consequences:

- global and project config writes require the V2 shell API for safe global
  reads and atomic replacement; a server without it is read-only
- Windows servers are read-only until atomic replacement is verified there
- there is no config validation endpoint; local JSONC/shape checks are followed
  by a `config.get` reload check, but server-only normalization warnings are not
  visible to the client
- the file replace has no conditional-write API; the provider re-reads the
  target immediately before rename, but a small race remains
- plugin installs are asynchronous; a valid config entry can still fail to load
- file-backed commands and system/remote skills are intentionally read-only
- the clean long-term fix is an upstream scoped config-write/validate endpoint
  and extension file CRUD; the current transaction and shell fallback should be
  removed once those exist

Deferred library replacements and extraction candidates are documented in
[library-extraction.md](library-extraction.md).

## 11. On-device wake word limits

The optional local path uses pretrained sherpa-onnx KWS, speaker-embedding,
Silero VAD, and Moonshine tiny English command models. No model training is
involved, but the accuracy in heavy TV/child babble has not been benchmarked on
physical devices yet.

Known limits:

- KWS runs while conversation mode is armed; it does not transcribe the room,
  but it still owns the microphone and consumes battery. The command ASR is
  loaded while armed so the post-wake window is not delayed.
- The bundled phrases are tokenized at install time; arbitrary phrases are not
  supported without runtime BPE tokenization.
- Voice verification is an enrollment-time cosine threshold, not a production
  speaker-verification system. Re-enrollment is required after a major voice
  change, and the threshold may need device-specific tuning.
- Target-speaker gating works on non-overlapping turns. Borderline matches get
  a split-half speaker-consistency check, which discards turns that look like
  they contain different voices. This is a heuristic, not source separation:
  simultaneous TV/child speech can still contaminate a turn and be dropped or
  transcribed imperfectly. A target-speaker extraction model would be needed for
  a stronger guarantee.
- Very short turns may be rejected before ASR because the speaker embedding is
  unreliable below roughly a third of a second.
- The command ASR defaults to English Moonshine; Whisper tiny multilingual is
  selectable and does not require training, but its short-command accuracy,
  latency, and auto-detect behavior are unbenchmarked. The wake phrase remains
  English because the KWS model is English.
- Reply readback uses the platform TTS engine. Wake detection pauses while TTS
  speaks and resumes afterward; barge-in over an active readback is not
  implemented yet.
- Local TTS is out of scope.
- The model pack is roughly 152 MB and the native runtime is prebuilt; both
  need review for F-Droid packaging/licensing.
- The local path is foreground-only; it does not run with the screen off.
- Model install/removal and voice enrollment do not yet stop an active local
  detector. Stop conversation mode before changing the local voice setup.
