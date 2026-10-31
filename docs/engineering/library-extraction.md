# Library Replacements And Extractions

This document records the library evaluation from the 2026-10-25 code review.
It separates work that is implemented from work that is deliberately deferred,
and it defines the extraction candidates that could become standalone packages.

## Implemented

- **Slider**: `shared/ui/numeric-slider.tsx` now uses
  `@react-native-community/slider` (Expo SDK 58 bundled version). The component
  keeps its label/value header and palette props; the package owns gestures,
  accessibility, and native controls. Its web build does not expose range
  semantics or arrow keys, so the wrapper forwards `aria-valuemin/max/now/text`
  and the previous keyboard stepping behavior to the rendered slider.
- **Store review**: Settings → Support uses `expo-store-review`. Android still
  falls back to the Play Store listing when the native review flow is
  unavailable; iOS can now offer the native App Store review flow. F-Droid
  builds exclude the native Play Review dependency, stub its JS entrypoint, and
  keep the rating action hidden.
- **Persisted DTO validation**: `zod` schemas now validate the session cache,
  transcript cache, capabilities cache, favorites, opened projects, remembered
  sessions, onboarding marker, update preferences, notification records,
  connection settings, and chat preferences. Existing fail-safe behavior is
  preserved: malformed envelopes clear the key, malformed individual entries
  are dropped where the previous parser dropped them, unknown fields are
  stripped, and unread keys stay preserved.
- **Base64**: `base-64` was replaced with `@scure/base` for connection scopes,
  Basic authentication, pairing payloads, attachment data URLs, and the
  generated working sound. This removes an untyped, unmaintained direct
  dependency and makes byte handling explicit.
- **File API**: `shared/protocol/opencode/attachment.ts` now uses the Expo SDK 58 `File`
  API instead of the `expo-file-system/legacy` module.

Two persistence boundaries remain intentionally manual:

- `features/widgets/model/widget-snapshot.ts` is a bounded projection with per-row salvage,
  preview redaction, and nested attention/plan fallbacks. A schema would be
  larger than the projection and would obscure the redaction contract.
- `shared/storage/connection-headers.ts` enforces RFC 7230 token rules, reserved-header
  rejection, duplicate detection, and editor error codes. Those are domain
  rules rather than a record shape.

## Evaluated And Deferred

These were considered during the review but were not landed. Each requires
native or UI validation that the web/static suites cannot provide.

### Keyboard handling

Keep RN keyboard avoidance, native modal hosts and the existing gesture stack.
The unused keyboard-height hook has been removed. A new controller needs a concrete
regression and physical-device acceptance across composer, Settings, terminal,
modals and hardware keyboards; SDK compatibility alone is not a reason to migrate.

### App updates (implemented)

SDK 58 enables `expo-in-app-updates` 0.13.0. Android explicitly requests immediate
updates, retaining safety blockers, cancellation cooldown and interrupted recovery.
Its native error fallback can open Play Store; the attempted candidate is suppressed
before handoff. iOS keeps its existing listing validation and intentional external
navigation, using Expo Application's verified production-environment API. The custom
update module is removed. See [app updates](../product/app-updates.md).

### Local classifier compatibility

`llama.rn` is pinned exactly to 0.12.9 with its matching upstream Android engine
binaries and iOS XCFramework. The 0.13 candidates checked through rc.9 force
Android engine source builds; their presence of binary files is insufficient.
Never enable `rnllamaBuildFromSource` or `RNLLAMA_BUILD_FROM_SOURCE`, override that
prerelease restriction to use stale binaries, or compile llama.cpp as a fallback.
The normal React Native JNI/Objective-C binding compilation remains necessary.

Stable 0.12.9 needs the small upstream iOS bridge backport because current React
Native headers removed `RCTCxxBridge`. The patch changes the binding's type access,
not the engine or model ABI. Remove it only when a compatible upstream release
also supplies matching prebuilts. See [upstream fix](https://github.com/mybigday/llama.rn/issues/384).
Retain lazy loading, the downloaded GGUF pack and completion API; physical-device
classifier acceptance remains required before release.

### Remaining dependency patches

| Owner | Version | Required behavior | Removal condition |
| --- | --- | --- | --- |
| Sharing | 58.0.21 | Text streams/accompanying text, unique bounded copies, unreadable items | Stable SDK-compatible upstream contains every fix; release/device sharing passes |
| Llama binding | 0.12.9 | Upstream iOS bridge type access for current RN headers; retain prebuilt engines | Compatible upstream release supplies this fix and matching engine prebuilts; device classifier checks pass |
| Sherpa | 1.3.1 | Android Kotlin/JNI config ABI and iOS TTS key aliases | Stable wrapper contains both fixes; Android/iOS local TTS passes |

These patches apply through patch-package. Sharing must remain built from source. The updater uses its unmodified upstream implementation.
Upstream Sherpa's beta fixes Android ABI but not the iOS alias handling; do not adopt
a prerelease only to delete part of a patch. Native source references:
[Expo Sharing](https://github.com/expo/expo/tree/main/packages/expo-sharing),
[Sherpa wrapper](https://github.com/deeeed/audiolab/tree/main/packages/sherpa-onnx.rn).
FOSS-only Firebase/install-referrer transformations stay in the existing flavor
preparation script and must be revalidated against each SDK's actual source.

Sherpa also carries `adm-zip` in its Node installer/validation scripts, where npm
reports unresolved archive-handling advisories, including
[unbounded allocation](https://github.com/advisories/GHSA-7q85-xj36-vmfc) and
[symlink extraction](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9).
This is build tooling, not the mobile model-extraction path. Restrict installer
archives to the reviewed upstream release inputs and track the upstream fix;
SDK compatibility and a reproducible lockfile do not establish a clean audit.

### Bottom sheets: `@gorhom/bottom-sheet`

`@gorhom/bottom-sheet` supports Reanimated 4 and web, and could replace
`OverlaySheet`, `CatalogSelect`'s modal sheet, and the model picker's sheet.

Deferred because the current sheet behavior is already factored through
`OverlaySheet` + `useSwipeDismiss`, is covered by flow tests, and integrates
directly with the primitive portal and the workspace-scope context. Adopt it only if
snap points, keyboard behavior, or gesture edge cases become a real problem.

### Diff rendering: `parse-diff` / `react-native-diffs`

`parse-diff` could replace the unified-patch parser in
`features/chat/ui/chat-diff.ts`. `react-native-diffs` provides a full native diff
viewer but uses Nitro Modules/MarkdownView and does not fit the existing compact
accordion cards without a redesign.

Deferred because the current parser is small, tuned to server-shaped patches,
and already covered by transcript/diff tests. Revisit if diff formats or
rendering requirements grow.

## Extraction Candidates

Extraction reduces this app's surface area but adds package release, versioning,
documentation, and CI overhead. Prefer an internal `packages/` boundary first;
publish only when there is a second consumer or clear ecosystem demand.

| Candidate | What Moves | Reuse Value | Effort | Recommendation |
|---|---|---|---|---|
| Expo terminal kit | `features/terminal/ui/terminal-dom`, touch, input, accessory, keys, CSS, and the generic decoder/queue from `shared/protocol/opencode/terminal-stream.ts` | High: Expo DOM + xterm with mobile touch selection, IME handling, accessory keys, resize, and acknowledged output is missing from the RN ecosystem | 2–3 weeks | Extract first or second |
| OpenCode fake server | `tests/fake-opencode/*` (v1/v2 servers, fixtures, SSE/PTY controls, self-test) | High: client authors need a deterministic OpenCode backend for contract, SSE, permission, question, and PTY tests | 1–2 weeks | Extract or upstream first |
| Expo secure connections | `shared/contracts/connection-scope.ts`, `connection-profiles.ts`, `connection-headers.ts`, `connection-password.ts` | Medium-high: multi-server self-hosted apps need scoped metadata, secure secrets, validation, ordering, and rotation | 2–3 weeks | Later, if demand exists |
| Resilient event stream | `runtime/realtime/*`, the transport half of `use-opencode-realtime.ts`, `shared-event-stream.ts` | Medium-high: RN SSE libraries handle transport, not liveness, AppState, NetInfo, polling fallback, and backoff | 1–2 weeks | Later, with a second consumer |
| Expo speech input | `shared/platform/voice/use-speech-input.ts`, errors, transcript accumulation, wake phrase, permissions, capabilities | Medium-high: owner coordination, on-device→network fallback, and wake-phrase gating sit above `expo-speech-recognition` | 2–3 weeks | Later |
| Ongoing activity service | `modules/opencode-activity` and the generic activity notification helpers | Medium: Android `dataSync` foreground service, promoted ongoing notification, and headless keepalive are common needs | 2–3 weeks | Check Notifee and existing foreground-service modules first |
| Source-owned UI | `CatalogSelect`, `OverlaySheet`, `NumericSlider`, `SwipeRow` | Medium: searchable select and swipe-dismiss sheets are missing RN primitives | 1 week | Internal package only unless a design-system release is intended |

### Terminal kit boundary

The package should own the DOM renderer and mobile interaction layer:
`TerminalDOM`, touch selection/scrolling, input/IME handling, the accessory
keyboard, key encoding, and the CSS. The app should keep the OpenCode PTY
transport, ticket acquisition, reconnect policy, workspace lifetime, and
provider state.

A first API could be:

```tsx
<TerminalView
  instances={instances}
  activeId={activeId}
  theme={theme}
  labels={labels}
  onReady={onReady}
  onWritten={onWritten}
  onInput={onInput}
  onResize={onResize}
  onPaste={onPaste}
  onCopy={onCopy}
/>
```

The package must be tested against the Expo DOM component version it supports;
that coupling is the main release risk.

### Fake server boundary

The package should expose a CLI and a programmatic scenario builder for both
contracts. The app keeps its Playwright specs and app-specific fixtures. The
existing `self-test.mjs` should remain in-repo as the behavioral contract for
the package version the app uses.

This is the lowest-coupling, highest-ecosystem-value extraction. Prefer
upstreaming it to the OpenCode repository if that project wants a supported
client test harness.

## Upstream Instead Of Publishing

- `patches/expo-sharing+58.0.21.patch` → `expo-sharing`. Upstreaming stream
  handling, accompanying text, unique bounded cache copies, and the resource
  keep rule would remove a version-pinned patch and the `buildFromSource`
  autolinking workaround.
- `shared/protocol/opencode/contracts/` + `shared/protocol/opencode/compat/v1/` → `@opencode/client` or
  a published compatibility package. This is the largest protocol maintenance
  surface in the app and belongs with the SDK.
- Content-capture opt-out in `config/plugins/android.cjs` → a small Expo config
  plugin or an Expo feature request.
- Personal Team push-entitlement removal in `config/plugins/ios.cjs` → an
  `expo-notifications` or `expo-build-properties` option.
- App updates now use the maintained immediate flow; do not restore flexible-download
  glue or the removed custom module.
- Fake server → the OpenCode repository if it wants a supported test harness.

## Keep In-App

These are intentionally app-specific and would become configuration-heavy
packages with one consumer:

- conversation mode state machine and playback/listening effects
- prompt inbox admission and reconciliation
- transcript window merge and anchor-aware ordering
- widget snapshot projections and Android widget trees
- Cloud Link purchase and activation flow
- chat cards and transcript presentation
- static i18n resource generation

## Validation

- Static changes: `npm run test:ci:static`.
- Fake-server changes: `npm run test:fake-server:self`.
- Provider, realtime, session, blocking, or SSE/polling changes:
  `npm run test:e2e:web`.
- Native-library additions: `npm run build:development:android` plus iOS/Android
  device checks.
- Any change to `tests/e2e/` or `tests/fake-opencode/` requires explicit human
  validation under `AGENTS.md`.
