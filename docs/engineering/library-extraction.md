# Library Replacements And Extractions

This document records the library evaluation from the 2026-10-25 code review.
It separates work that is implemented from work that is deliberately deferred,
and it defines the extraction candidates that could become standalone packages.

## Implemented

- **Slider**: `components/ui/numeric-slider.tsx` now uses
  `@react-native-community/slider` (Expo SDK 57 bundled version). The component
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
- **File API**: `lib/opencode/attachment.ts` now uses the Expo SDK 57 `File`
  API instead of the `expo-file-system/legacy` module.

Two persistence boundaries remain intentionally manual:

- `providers/widget-snapshot.ts` is a bounded projection with per-row salvage,
  preview redaction, and nested attention/plan fallbacks. A schema would be
  larger than the projection and would obscure the redaction contract.
- `lib/connection-headers.ts` enforces RFC 7230 token rules, reserved-header
  rejection, duplicate detection, and editor error codes. Those are domain
  rules rather than a record shape.

## Evaluated And Deferred

These were considered during the review but were not landed. Each requires
native or UI validation that the web/static suites cannot provide.

### Keyboard handling: `react-native-keyboard-controller`

Expo SDK 57 bundles `react-native-keyboard-controller` 1.21.9. It could replace
`hooks/use-keyboard-height.ts` and several `KeyboardAvoidingView` workarounds,
and it may help the Android keyboard-flicker path described for issue #62.

Deferred because it has no obvious web implementation, the app's web E2E suite
must keep working, and a native iOS/Android device pass is required for the
composer, Settings voice form, terminal accessory, overlays, and hardware
keyboards. A future change should add a platform-gated wrapper and migrate one
surface first, not replace every `KeyboardAvoidingView` at once.

### App updates: `expo-in-app-updates`

`expo-in-app-updates` already wraps Google Play Core and the App Store, which
overlaps with `modules/opencode-updates` and `lib/app-updates.ts`.

Deferred because:

- 0.12.x targets Expo SDK 56 and 0.13.x targets SDK 58; SDK 57 compatibility is
  not established.
- The current module supports explicit flexible-download completion and
  process-death recovery, which are central to the existing banner contract.
- Replacing the native module needs a signed Play internal-track test and a
  public App Store test.

If the package covers those behaviors, delete the local module and most of
`lib/app-updates.ts`; otherwise upstream the missing behavior instead of
publishing a competing module.

### Bottom sheets: `@gorhom/bottom-sheet`

`@gorhom/bottom-sheet` supports Reanimated 4 and web, and could replace
`OverlaySheet`, `CatalogSelect`'s modal sheet, and the model picker's sheet.

Deferred because the current sheet behavior is already factored through
`OverlaySheet` + `useSwipeDismiss`, is covered by flow tests, and integrates
directly with the primitive portal and the workspace-scope context. Adopt it only if
snap points, keyboard behavior, or gesture edge cases become a real problem.

### Diff rendering: `parse-diff` / `react-native-diffs`

`parse-diff` could replace the unified-patch parser in
`components/chat/chat-diff.ts`. `react-native-diffs` provides a full native diff
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
| Expo terminal kit | `components/terminal/terminal-dom`, touch, input, accessory, keys, CSS, and the generic decoder/queue from `lib/opencode/terminal-stream.ts` | High: Expo DOM + xterm with mobile touch selection, IME handling, accessory keys, resize, and acknowledged output is missing from the RN ecosystem | 2–3 weeks | Extract first or second |
| OpenCode fake server | `tests/fake-opencode/*` (v1/v2 servers, fixtures, SSE/PTY controls, self-test) | High: client authors need a deterministic OpenCode backend for contract, SSE, permission, question, and PTY tests | 1–2 weeks | Extract or upstream first |
| Expo secure connections | `lib/connection-scope.ts`, `connection-profiles.ts`, `connection-headers.ts`, `connection-password.ts` | Medium-high: multi-server self-hosted apps need scoped metadata, secure secrets, validation, ordering, and rotation | 2–3 weeks | Later, if demand exists |
| Resilient event stream | `providers/realtime/*`, the transport half of `use-opencode-realtime.ts`, `shared-event-stream.ts` | Medium-high: RN SSE libraries handle transport, not liveness, AppState, NetInfo, polling fallback, and backoff | 1–2 weeks | Later, with a second consumer |
| Expo speech input | `lib/voice/use-speech-input.ts`, errors, transcript accumulation, wake phrase, permissions, capabilities | Medium-high: owner coordination, on-device→network fallback, and wake-phrase gating sit above `expo-speech-recognition` | 2–3 weeks | Later |
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

- `scripts/prepare-android-sharing.cjs` → `expo-sharing`. Upstreaming stream
  handling, accompanying text, unique bounded cache copies, and the resource
  keep rule would remove a version-pinned patch and the `buildFromSource`
  autolinking workaround.
- `lib/opencode/contracts/` + `lib/opencode/compat/v1/` → `@opencode/client` or
  a published compatibility package. This is the largest protocol maintenance
  surface in the app and belongs with the SDK.
- Content-capture opt-out in `config/plugins/android.cjs` → a small Expo config
  plugin or an Expo feature request.
- Personal Team push-entitlement removal in `config/plugins/ios.cjs` → an
  `expo-notifications` or `expo-build-properties` option.
- App-update behavior → `expo-in-app-updates` if it can cover flexible-download
  recovery.
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
