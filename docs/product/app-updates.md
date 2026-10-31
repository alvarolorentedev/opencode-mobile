# App updates

`OpencodeProvider` owns `useAppUpdates`; `useUpdates()` exposes the update notice,
store actions and blocker registration. `shared/platform/app-updates.ts` is the platform
boundary. The tab shell renders a compact nonmodal banner above the tabs
on Chat, Project, Settings and Terminal; onboarding, pairing and session routes do
not offer updates. The banner uses source-owned controls, the light/dark theme, including
its fixed accent, and all nine locales. It wraps its actions on narrow screens
and retains access to the tabs. It occupies layout space above the default tab
bar, keeping both the composer and navigation visible. The root shell owns route
eligibility, the handoff gate and failure snackbar.

## Android

`shared/platform/android-app-updates.ts` wraps `expo-in-app-updates` 0.13.0.
Production builds require Expo Application's Play install-referrer service to be
available; Play Core enforces account ownership, matching signing and a higher
version code. Signed Play-installed acceptance remains required.
The adapter calls `startUpdate(true)` explicitly. It never uses the helper that
can fall back to flexible mode, and suppresses candidates where immediate updates
are not allowed. Play owns blocking consent, download and installation; there is
no background-download or Restart & install banner. The library is unpatched:
its native lifecycle, download-completion listener and Play Store error fallback
retain upstream behavior. App-side gates protect launch, while Play and the native
library own the active flow. JS does not intercept native completion; upgrade from
the previous flexible implementation is a required signed store/device check.

An available update opens Play consent at the first safe moment, without a themed
offer. Existing unsaved-work, route, foreground and operation blockers remain.
An accessible gate protects the asynchronous handoff; Play's native activity then
owns interaction blocking. Safety is rechecked after asynchronous reads and before
launch. Cancellation dismisses the attempted version for seven days. The native
package may open Play Store on native errors, so dismissal is recorded before
handoff; returning never repeatedly launches the same candidate. Attempted handoffs
are distinguished from confirmed cancellations: cold recovery can resume again
after another process death, while cancellation retains its cooldown even when
Play omits the in-progress version. A running provider hands off an in-progress
flow at most once. JS failures show
the existing short feedback. Listeners are removed on teardown.

The provider checks after hydration and onboarding, and on foreground entry.
Settings → Advanced → Update checks owns the feature: an enable toggle and a check
period of When available (default), Daily, or Weekly. These preferences control
app checks and reminders, not the store's automatic-update setting. "When available" checks on
every foreground entry so a new version surfaces immediately; Daily and Weekly
throttle discovery to that interval, including failed attempts. Android queries
interrupted immediate-update state on foreground entry even inside a throttled interval
so the native immediate flow can resume after process death; that recovery query does not
rediscover an available update inside the interval. Cancellation/Later suppresses a version for seven days; a new version resets it. Preferences use
`opencode-mobile.app-updates`. Unreadable storage suppresses offers for that run;
malformed persisted values are cleared through the existing helper. Legacy downloaded-stage dismissals keep their version and cooldown, mapped to the remaining available stage.

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
The iOS release workflow reads the corresponding GitHub repository variables;
leaving the ID unset keeps the feature disabled in that pipeline.

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
Play and the account owning it, check immediate consent/cancel, blocking download
and install, process death/resume, offline/error/store fallback and cooldowns.
Verify no native handoff occurs while composing, editing a file, opening a modal,
running a task, using voice or purchasing Cloud Link. Preserve those contents when
the offer is suppressed. Verify only immediate requests are made, including low
Play priority, and that returning from Play's error fallback never loops.

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
