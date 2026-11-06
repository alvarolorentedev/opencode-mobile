# App updates

`OpencodeProvider` owns `useAppUpdates`; `useUpdates()` exposes the update notice,
store actions and blocker registration. `shared/platform/app-updates.ts` is the platform
boundary. The tab shell renders a compact nonmodal banner above the tabs
on Chat, Project, Settings and Terminal; onboarding, pairing and session routes do
not offer updates. The banner carries the available-update offer; a finished download instead
surfaces a restart toast above the tab bar, so the install prompt never takes
layout space. The banner uses source-owned controls, the light/dark theme, including
its fixed accent, and all supported locales. It wraps its actions on narrow screens
and retains access to the tabs. It occupies layout space above the default tab
bar, keeping both the composer and navigation visible. The root shell owns route
eligibility, the restart toast, the handoff gate and failure snackbar.

## Android

`shared/platform/android-app-updates.ts` wraps `expo-in-app-updates` 0.13.0 with
one pinned patch (`patches/expo-in-app-updates+0.13.0.patch`; see
[ADR 0031](../adr/0031-flexible-updates-with-explicit-install.md) and
[ADR 0036](../adr/0036-flexible-first-with-play-urgency.md)).
Production builds require Expo Application's Play install-referrer service to be
available; Play Core enforces account ownership, matching signing and a higher
version code. Signed Play-installed acceptance remains required.
The adapter reads Play's `serverPriority`: priorities 0-3 request flexible mode,
4-5 request immediate mode, and a refused type falls back to the other type only
when Play reports it as allowed. It never uses the helper that picks from server
priority. Release publication sets that value through `inAppUpdatePriority`
(`update_priority` workflow input, default `0`); see
[release priority](../engineering/development.md#in-app-update-priority).
Flexible updates download in the background while the app stays usable; the
patch stops the library's automatic install on download completion, so the
install waits for an explicit Restart tap behind the app-side safety gates.
The native lifecycle, Play Store error fallback and completion listener
otherwise retain upstream behavior. App-side gates protect both download start
and install; JS never auto-installs a finished download. Cold recovery of a
finished download is a required signed store/device check.

An available update starts its download at the first safe moment: a flexible
download proceeds in the background without a themed offer, while an urgent or
flexible-refused candidate opens Play consent. A finished download surfaces a restart
toast; the install runs from the downloaded snapshot and restarts the app only after
an explicit tap re-verifies safety. Existing unsaved-work, route, foreground and operation blockers
suppress both download start and install. An accessible gate protects the
asynchronous handoff; Play's native activity then owns interaction blocking
for immediate consent. Safety is rechecked after the asynchronous native read and before
launch and install. Cancellation dismisses the attempted version for seven days. The native
package may open Play Store on native errors, so dismissal is recorded before
handoff; returning never repeatedly launches the same candidate. Attempted handoffs
are distinguished from confirmed cancellations: cold recovery can resume again
after another process death, while cancellation retains its cooldown even when
Play omits the in-progress version. A running provider hands off an in-progress
flow at most once; a finished download never auto-installs in one process, but
an attempted install resumes after process death. JS failures show
the existing short feedback. Listeners are removed on teardown.

The provider checks after hydration and onboarding, and on foreground entry.
Settings → Advanced → Update checks owns the feature: an enable toggle and a check
period of When available (default), Daily, or Weekly. These preferences control
app checks and reminders, not the store's automatic-update setting. "When available" checks on
every foreground entry so a new version surfaces immediately; Daily and Weekly
throttle discovery to that interval, including failed attempts. Android queries
interrupted immediate-update state and finished flexible downloads on foreground entry even inside a throttled interval
so the native immediate flow can resume, and a finished download can resurface, after process death; that recovery query does not
rediscover an available update inside the interval. Cancellation/Later suppresses a version for seven days; a new version resets it. Dismissal records its stage: Later on the offer suppresses that version's offer, Later on the restart toast suppresses that version's install; a handoff that never starts keeps the toast offered instead of recording that cooldown. Preferences use
`opencode-mobile.app-updates`. Unreadable storage suppresses offers for that run;
malformed persisted values are cleared through the existing helper. Persisted
downloaded-stage dismissals keep their version, stage and cooldown under the
downloaded stage.

Update actions recheck foreground, route and safety after the async native read.
Active/sending/queued tasks, conversation mode, pending permissions/questions,
connection work, terminal creation/open/close and Cloud Link purchase/setup suppress
offers. Components retain their local drafts, attachments and form contents;
`useUpdateBlocker` only registers that they are busy. Open sheets, pickers, file
previews, connection/provider forms, voice input/playback and native attachment
selection also suppress offers.

The FOSS preparation script excludes `expo-in-app-updates` from autolinking, removing
its Play dependency from that build. JS also rejects FOSS, Expo Go, development,
E2E and ordinary web runs. The web test fixture is available only when both the
explicit E2E mode and development test configuration are enabled.

## iOS configuration prerequisite

The numeric App Store ID is still missing. Configure `EXPO_IOS_APP_STORE_ID` only
after verifying the published listing belongs to `app.getopencode.mobile`.
`EXPO_IOS_APP_STORE_COUNTRY` optionally selects a two-letter lookup storefront;
omitting it uses Apple's default. These values are embedded at build time.
Android works independently of these settings. No ID is guessed.
The tag-driven release workflow reads the corresponding GitHub repository
variables; leaving the ID unset keeps the feature disabled in that pipeline.

Without a valid ID, iOS does no native or network lookup. Expo Application's
`getAppleStoreEnvironmentAsync()` uses a verified StoreKit AppTransaction and must
return `production`; TestFlight/sandbox, development and unverifiable installs
are ineligible. Native bundle ID/version must match the configured app. No receipt
refresh, purchase initialization or StoreKit product sheet is introduced.
TypeScript validates the lookup's ID, bundle ID and numeric release
version. The banner's explicit "Open App Store" action opens a constructed
official App Store URL; iOS does not install
or restart through this feature. Timeout, unavailable listings and store failures
never delay boot or produce an unsolicited prompt.

## Acceptance

Run the [existing gate and native matrix](../engineering/validation/strategy.md).
Store variants autolink the maintained updater; FOSS excludes it and its Play Core
dependencies. The former custom update module is removed on both platforms.

On two signed Play internal-track releases, with the older app installed through
Play and the account owning it, check immediate consent/cancel, flexible
background download with explicit install, blocking download
and install, process death/resume in both modes, busy-at-completion,
offline/error/store fallback and cooldowns.
Verify no native handoff or install occurs while composing, editing a file, opening a modal,
running a task, using voice or purchasing Cloud Link. Preserve those contents when
the offer is suppressed. Verify flexible is requested first, immediate is used
only when Play refuses it or marks priority 4-5, and that returning from Play's
error fallback never loops.

The content-capture ANR mitigation remains directly after the generated
MainActivity superclass call. Inspect the minified release and exercise large
transcripts/catalogs with content capture enabled on the device; do not remove
this mitigation based solely on a development build or a lifecycle callback.

On a public App Store installation, verify the configured ID and storefront,
matching/newer/equal versions and explicit store navigation. Verify TestFlight,
signed-out/unverifiable and offline cases quietly suppress the offer. Check
light/dark, slim, large text, screen readers and native safe areas on both platforms.
Web fixtures verify orchestration, not real store eligibility or installation.
Changes to E2E contracts require explicit human validation under AGENTS.md.
