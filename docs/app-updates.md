# App updates

`OpencodeProvider` owns `useAppUpdates`; `useUpdates()` exposes the update notice,
store actions and blocker registration. `lib/app-updates.ts` is the platform
boundary. The root shell renders the offer through the shared `OverlaySheet` overlay
on Chat, Workspace and Settings; Terminal, onboarding, pairing and session routes do
not offer updates. The offer and the install handoff reuse the existing overlay and
Paper controls, the light/dark theme, including its fixed accent, and all eight locales.

## Android

The local Expo module `modules/opencode-updates` uses Google's official
`com.google.android.play:app-update:2.1.0`, with Expo SDK 57's Gradle plugin and a
namespace. Only non-debuggable apps installed by Google Play are eligible. Play
still enforces app ownership, signing and a higher available version code.
The module declares `defaultConfig.versionName = '1.0.0'`, which Expo's Gradle
publication setup requires separately from the app's release version.

Update starts a flexible download after native Play consent. Download completion
only raises the ready offer. A second explicit Update tap on that offer calls
`completeUpdate()`; its text warns that the app will restart. No listener,
foreground event or cold launch installs an update automatically. The non-dismissible
handoff overlay blocks new edits while opening store consent and during installation.
Cancellation and failures dismiss the same candidate; failures show a short error
without automatically opening the Play Store. Listeners are removed on teardown.

The provider checks after hydration and onboarding, and on foreground entry.
Discovery is throttled for 12 hours, including failed attempts. Android queries
native download/install state on foreground entry even inside that interval so a
pending download can recover after process death. This recovery query does not
rediscover an available update inside the discovery interval. Later suppresses a
version and stage for seven days; a new version or downloaded stage resets it.
Preferences use `opencode-mobile.app-updates`. Unreadable storage suppresses offers
for that run; malformed persisted values are cleared through the existing helper.

Update actions recheck foreground, route and safety after the async native read.
Active/sending/queued tasks, conversation mode, pending permissions/questions,
connection work and Cloud Link purchase/setup suppress offers. Components retain
their local drafts, attachments and form contents; `useUpdateBlocker` only registers
that they are busy. Open sheets, pickers, file previews, connection/provider forms,
voice input/playback and native attachment selection also suppress offers.

The FOSS preparation script excludes `opencode-updates` from autolinking, removing
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

Without a valid ID, iOS does no native or network lookup. The small Swift helper
requires a verified production `AppTransaction` matching the running bundle;
TestFlight/sandbox, debug, simulator and unverifiable installations return no
candidate. It uses `AppTransaction.shared`, never refreshes receipts or initializes
purchases. TypeScript validates the lookup's ID, bundle ID and numeric release
version. Update opens a constructed official App Store URL; iOS does not install
or restart through this feature. Timeout, unavailable listings and store failures
never delay boot or produce an unsolicited prompt.

## Acceptance

Run static CI, fake-server self-tests, web E2E and FOSS preparation checks. Native
builds must autolink this module for store variants and exclude it for FOSS.

On two signed Play internal-track releases of the same package, with the older
version installed through Play and the account owning it, check consent/cancel,
background download, process death, recovery, Later and failure. Verify a downloaded
update never restarts while composing, editing a file, opening a modal or using
voice, and installs only after the explicit ready action on a safe screen. Check
that the interaction gate prevents starting new unsaved work during handoff.

On a public App Store installation, verify the configured ID and storefront,
matching/newer/equal versions and explicit store navigation. Verify TestFlight,
signed-out/unverifiable and offline cases quietly suppress the offer. Check
light/dark, slim, large text, screen readers and native safe areas on both platforms.
Web fixtures verify orchestration, not real store eligibility or installation.
Changes to E2E contracts require explicit human validation under AGENTS.md.
