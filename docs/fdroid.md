# F-Droid and FOSS builds

OpenCode Mobile ships a de-Googled **FOSS variant** so the app can be distributed
through F-Droid without the proprietary Android libraries F-Droid's inclusion
policy forbids.

## Why a variant exists

The Play/iOS build uses three proprietary Android components:

- `expo-iap` → Google Play Billing (optional Cloud Link subscription)
- `expo-camera` barcode scanning → Google ML Kit + `play-services-code-scanner` (Cloud Link QR pairing)
- `expo-notifications` → `com.google.firebase:firebase-messaging` (pulled in even though the app only posts local notifications)

F-Droid forbids Google Play Services and Firebase in all apps, and requires
upstream to provide a build flavour without them. The FOSS variant:

- excludes `expo-iap` and `expo-camera` from autolinking and plugins, and
  redirects their JS imports to stubs in `lib/foss/` via `metro.config.js`
- disables the Cloud Link paid-subscription and QR-pairing surfaces by returning
  `false` from `isConnectEnabled()` when `extra.foss` is set
- keeps local task-completion notifications by compiling `expo-notifications`
  against F-Droid's free `firebase-stubs` classes instead of `firebase-messaging`

The self-hosted OpenCode experience (connections, sessions, workspace, terminal,
files, voice) is unchanged. Only the optional paid Cloud Link path is absent.

## Building locally

```bash
npm run build:foss:android
```

This runs `scripts/build-android-release.mjs` with `OPENCODE_BUILD_FLAVOR=foss`.
The FOSS build downloads Firebase stub source revision
`ce90a956aacda17a85c60577ee443aeb83d876ef` into a temporary checkout, supplies it
through `FIREBASE_STUB_SRC_DIR`, and removes the checkout when it exits. An
existing source directory can be supplied through that environment variable.
It then applies `scripts/foss-prepare.mjs` and builds with the FOSS variant:

1. `scripts/foss-prepare.mjs` (shared with the fdroiddata recipe, so both builds
   get byte-identical dependency patches):
   - injects `expo.autolinking.exclude: ["expo-iap", "expo-camera"]` into
     `package.json` for the duration of the build (the build script restores it)
   - swaps `expo-notifications`' `firebase-messaging` dependency for free stub
     sources supplied through `FIREBASE_STUB_SRC_DIR`; F-Droid supplies its
     pinned `firebase-stub` srclib at the same revision
   - removes `expo-application`'s proprietary `com.android.installreferrer`
     dependency and stubs its `getInstallReferrerAsync`
2. `expo prebuild` and Gradle run with `EXPO_APP_VARIANT=foss`,
   `EXPO_PUBLIC_FOSS=1`, and app id `app.getopencode.fdroid`

Signing uses the same `ANDROID_KEYSTORE_*` environment variables as
`npm run build:android`. On CI the `foss-release` job builds the variant, asserts
the APK contains no Play Billing, ML Kit, install-referrer, or
`play-services-code-scanner` libraries, and attaches
`opencode-mobile-fdroid.apk` to `v*` GitHub releases.
The free stub classes keep the `com.google.firebase` package name; that namespace
alone does not indicate that proprietary Firebase code is present. The
preparation script fails if the supplied stub source classes are missing.

The FOSS package id is `app.getopencode.fdroid`, so it can be installed
alongside a Play Store build.

## Distribution

There is no self-hosted F-Droid repo. The FOSS build is distributed two ways:

- **Main F-Droid repository** — the intended distribution. Submission requires a
  recipe in an `fdroiddata` fork; a draft lives at
  `fdroid/fdroiddata/app.getopencode.fdroid.yml` (see `fdroid/README.md`). Because
  the project does not commit `android/`, the recipe cannot use `subdir`
  (fdroidserver checks it exists before `prebuild`). Instead it runs `npm ci`,
  `scripts/foss-prepare.mjs`, `npx expo prebuild -p android --clean`, strips the
  release `signingConfig`, then uses a manual `build:` to run
  `gradle assembleRelease`, with `output:` pointing at the unsigned APK.
  The recipe follows F-Droid's React Native template and uses its pinned
  `firebase-stub` srclib; upstream FOSS builds download the same revision only
  when building the FOSS variant. Reproducible builds are **not enabled**:
  upstream uses JDK 17 and Expo
  prebuilts, whereas the F-Droid recipe uses JDK 21 and builds Expo modules from
  source. No byte-identical APK comparison has passed. The recipe therefore has
  no `Binaries` or `AllowedAPKSigningKeys` field. F-Droid will sign with its own
  key, so GitHub APKs cannot update an F-Droid installation. Resolve this before
  the first F-Droid publication if the upstream signing key must be retained;
  matching the JDK alone does not establish reproducibility. See
  [F-Droid's reproducible-build guide](https://f-droid.org/docs/Reproducible_Builds/).
- **GitHub releases** — the `foss-release` CI job attaches
  `opencode-mobile-fdroid.apk` to `v*` releases for direct sideloading.

Anti-features: voice input relies on the device's system speech recognizer,
which on many devices is supplied by Google. If F-Droid reviewers apply
`NonFreeNet`, declare it rather than dropping voice.

## Keeping the variant working

When changing dependencies or native config:

- `npm run test:ci:static` and `npm run typecheck` must stay green
- `npm run test:architecture` guards the layering; FOSS stubs live in `lib/foss/`
- update the Firebase stub revision in `scripts/build-android-release.mjs`
  and the recipe's `firebase-stub` srclib together if `expo-notifications`
  needs a newer stub API

## Store metadata

F-Droid imports the English text and artwork from
`fastlane/metadata/android/en-US/` at the recipe's pinned source commit. It
contains the summary, full description, title, version-code changelogs, a
512 × 512 PNG icon, and five 1080 × 2424 PNG phone screenshots. The artwork was
retrieved from the author's [Google Play listing](https://play.google.com/store/apps/details?id=app.getopencode)
on 2026-10-07. Keep this content in the upstream repository; copy only the build
recipe to fdroiddata. A local or uncommitted asset is not available to F-Droid.

See [`fdroid/checklist.md`](../fdroid/checklist.md) for the submission review and
the remaining publication conditions.

The shared FOSS preparation also excludes the local `opencode-updates` Expo module
from autolinking, so Google Play In-App Updates is absent from the FOSS artifact.
The JS boundary disables store update prompts for this flavor.
