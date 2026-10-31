# ADR 0017: Native defaults and prebuilt engines

- Status: Accepted
- Date: 2026-10-31
- Deciders: maintainers
- Supersedes: [ADR 0016](0016-supported-expo-native-integrations.md)
- Related: [Native integrations](../engineering/integrations-and-operations.md), [Library decisions](../engineering/library-extraction.md)

## Context

The final migration requirements prefer the updater's upstream behavior and
require prebuilt Llama engines. These refine the adapter/patch choices in ADR
0016. The SDK 58 baseline, ownership, CNG conventions, exact content-capture
mitigation timing, FOSS exclusions, optional agent tooling and existing validation
policy from that decision remain in force.

## Decision

Use unmodified `expo-in-app-updates` 0.13.0. Call `startUpdate(true)` explicitly;
never use its automatic-selection helper or request flexible updates. Retain the
app's unsaved-work, route and foreground gates, cancellation cooldown and cold
recovery. Distinguish attempted handoffs from confirmed cancellations. The native
library keeps its default lifecycle, completion listener and automatic Play Store
fallback; JS does not intercept those native behaviors. Validate migration from
the former flexible flow on signed store installations before release.

iOS retains Expo Application's verified production eligibility, validated listing
lookup and intentional external App Store navigation. Do not call the updater's
iOS StoreKit presentation API.

Pin `llama.rn` exactly to 0.12.9 with matching upstream Android engine binaries and
iOS XCFramework. Never enable engine source builds or override a source-only
release's restriction using stale binaries. Normal JNI/ObjC binding compilation
is required. Backport only the upstream iOS bridge type fix needed by current RN
headers. Reject the checked 0.13 candidates through rc.9 because they force Android
engine source builds. Keep model loading lazy and preserve the existing pack/API.

## Consequences

The updater policy patch is removed. Three pinned patches remain: Sharing input
safety, Sherpa ABI/iOS keys, and the Llama iOS binding backport. Their removal
conditions live in the library inventory. A clean lockfile install and native
builds verify the selected artifacts; physical/store acceptance remains required.
No new native E2E framework, CI workflow or recurring service is introduced.

## Alternatives considered

- Keep a custom Android updater: rejected in favor of the requested upstream
  package behavior and smaller local native ownership.
- Patch the updater's listener/lifecycle: rejected in favor of upstream defaults.
- Adopt Llama 0.13 candidates or force their prebuilt path: violates the prebuilt
  requirement or risks an engine/binding ABI mismatch.
- Drop optional native features: violates the supported functionality requirement.

## Rollback

Revert the coordinated migration commits and lockfile, then regenerate native
projects. Retain model files, credentials and preferences. Published builds require
a higher-numbered forward release; see the existing production validation matrix.

## Follow-up

- [x] Complete automated gates and Android development/production/FOSS builds plus unsigned iOS Release compilation for the pinned prebuilt set.
- [ ] Complete signed Play/App Store, migration and physical-device acceptance.
- [ ] Obtain explicit human validation of the changed E2E contracts.
