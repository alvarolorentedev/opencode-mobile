# ADR 0019: ARM64-only Android release artifacts

- Status: Accepted
- Date: 2026-10-31
- Deciders: maintainers
- Supersedes: —
- Related: [`scripts/build-android-release.mjs`](../../scripts/build-android-release.mjs), [`config/plugins/android.cjs`](../../config/plugins/android.cjs), [`scripts/ci/verify-android-release.mjs`](../../scripts/ci/verify-android-release.mjs), [`.github/workflows/release.yml`](../../.github/workflows/release.yml), [Integrations and operations](../engineering/integrations-and-operations.md), [ADR 0018](0018-tag-driven-release-pipeline.md)

## Context

Android release builds previously varied by trigger: tagged builds included
`armeabi-v7a` and `arm64-v8a`, while untagged builds could include `x86_64` for
emulators. Maintaining multiple release ABI configurations increased native
compilation time, artifact size and verification surface. The project does not
need to support 32-bit-only Android devices, and release validation no longer
uses an emulator.

Modern Android releases must also remain compatible with 16 KB memory pages.
That requirement applies to native library ELF alignment and APK zip alignment,
not to a particular device architecture.

## Decision

Every Android release artifact uses exactly `arm64-v8a`:

- Google Play APK and AAB
- FOSS/F-Droid APK
- Any local release build produced by `scripts/build-android-release.mjs`

`armeabi-v7a`, `x86` and `x86_64` are removed from release configurations. There
is no `ANDROID_RELEASE_ABIS` override, no per-tag ABI branch and no
emulator-specific release ABI. The Expo config plugin writes
`reactNativeArchitectures=arm64-v8a` into the generated release
`android/gradle.properties`; the release build script asserts the property and
also passes `-PreactNativeArchitectures=arm64-v8a`.

Release verification requires:

- only ARM64 native libraries in the APK and in the AAB base module;
- expected critical native libraries;
- 16 KB ELF `PT_LOAD` alignment for every native library;
- 16 KB APK zip alignment (`zipalign -c -P 16`);
- signing, package identity, version, R8/ProGuard and FOSS-exclusion checks.

Development builds are not release artifacts and may retain the Expo template
ABIs for local emulator use. No CI or release job builds or publishes them.

No emulator, self-hosted runner or paid device-testing service is added. Google
Google Play internal testing and TestFlight are the primary real-device validation
environments. Static artifact verification cannot guarantee successful device
startup.

## Consequences

- Android release builds are smaller and faster because only one native ABI is
  compiled and packaged.
- 32-bit-only Android devices are no longer supported. This is an intentional
  product decision, not a compatibility gap to revisit based on device reach.
- Prebuilt native libraries must remain 16 KB page-size compatible. A library
  that fails alignment blocks the release; it must be updated, patched or
  removed rather than shipped.
- Release verification is deterministic and does not depend on emulator
  availability or runner virtualization.
- Device-only startup, rendering or native initialization failures are found in
  Google Play internal testing or TestFlight. The fix is a new version and tag; release
  tags are never moved.

## Alternatives considered

- **Keep `armeabi-v7a` for 32-bit devices:** rejected because it adds native
  build time and artifact size for a legacy audience the product does not need to
  support.
- **Keep `x86_64` for emulator acceptance:** rejected because the project does
  not add emulator infrastructure or a second production ABI for release checks.
- **Use a self-hosted emulator or paid device farm:** rejected as unnecessary
  operational cost; store internal testing is the real-device environment.
- **Ship without 16 KB verification:** rejected because modern Android and Play
  require 16 KB compatibility and the check is cheap and deterministic.

## Follow-up

- [x] Hardcode ARM64-only release ABI in the config plugin and build script.
- [x] Remove ABI overrides from CI and release workflows.
- [x] Add APK/AAB ABI, native-library and 16 KB alignment checks.
- [x] Update development, validation and F-Droid documentation.
- [ ] Confirm the first ARM64-only release artifact in Google Play internal testing.
