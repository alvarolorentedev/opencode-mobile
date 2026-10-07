# F-Droid submission

This directory holds the material for submitting OpenCode Mobile's de-Googled
FOSS build to the **main F-Droid repository**. There is no self-hosted F-Droid
repo; users install either from F-Droid or from the `opencode-mobile-fdroid.apk`
asset on GitHub releases.

See [`docs/fdroid.md`](../docs/fdroid.md) for how the FOSS variant is produced.

## Submitting to fdroiddata

1. Ensure the upstream source commit contains the FOSS support, pinned
   `vendor/firebase-stubs` submodule, and complete `en-US` Fastlane metadata.
   Releases use `v*` tags; the `foss-release` CI job attaches the FOSS APK.
2. Fork and clone [fdroiddata](https://gitlab.com/fdroid/fdroiddata).
3. Copy `fdroiddata/app.getopencode.fdroid.yml` into the fork at
   `metadata/app.getopencode.fdroid.yml`, and set `commit:` to that release's
   full source commit SHA. If metadata or build support was added after the
   release tag, pin the public commit containing those fixes.
4. Decide the signing approach before first publication. Reproducible builds
   are currently not enabled; the reasons are recorded in `MaintainerNotes`
   and [`docs/fdroid.md`](../docs/fdroid.md). Only after unsigned APK equivalence
   has been verified should you enable `Binaries`/`AllowedAPKSigningKeys` or
   extract upstream signatures:
   ```bash
   curl -L -o opencode-mobile-fdroid.apk \
      https://github.com/alvarolorentedev/opencode-mobile/releases/download/v1.0.52/opencode-mobile-fdroid.apk
   fdroid signatures opencode-mobile-fdroid.apk
   ```
   Place the extracted files under
   `metadata/app.getopencode.fdroid/signatures/<versionCode>/`.
5. Validate:
   ```bash
   fdroid checkupdates --allow-dirty app.getopencode.fdroid
   fdroid lint app.getopencode.fdroid
   fdroid build app.getopencode.fdroid
   ```
6. Keep the fork public and the source branch unprotected. Use the MR title
   `New app: OpenCode Mobile`, include the checklist and reproducibility
   explanation, and submit only `metadata/app.getopencode.fdroid.yml`.
   F-Droid maintainers review, build, and publish it.

## Reviewer notes

- The FOSS build excludes Google Play Billing and ML Kit barcode scanning and
  compiles `expo-notifications` against F-Droid's `firebase-stubs` rather than
  Firebase Cloud Messaging. Local notifications still work.
- Voice input uses the device's system speech recognizer; if reviewers apply
  `NonFreeNet`, declare it in the recipe rather than dropping the feature.
