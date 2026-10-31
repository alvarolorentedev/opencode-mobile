# ADR 0016: Supported Expo native integrations

- Status: Superseded by ADR 0017
- Date: 2026-10-31
- Deciders: maintainers
- Supersedes: —
- Related: [ADR 0013](0013-source-owned-ui-and-complex-forms.md), [ADR 0014](0014-server-data-and-explicit-lifecycles.md), [ADR 0015](0015-feature-oriented-implementation.md), [Native integrations](../engineering/integrations-and-operations.md)

## Context

Native maintenance should follow the supported Expo SDK without replacing working
capabilities with incomplete alternatives. SDK 58 supplies a verified Apple store
environment API, an optimized Android template and compatible agent tooling.

## Decision

Use Expo SDK 58's dependency mapping and the existing CNG/build workflow. Keep
unrelated dependencies locked. Product policy stays in features; device resources
and third-party SDK calls remain behind shared platform interfaces. Retain the
single runtime owners and existing source-owned UI, Query and form conventions.

Android store updates use `expo-in-app-updates` with explicit immediate mode only.
Never call its automatic-selection helper. Existing readiness, unsaved-work and
foreground blockers apply before native handoff and interrupted-update recovery.
Cancellation keeps its cooldown. The native library may open Play Store on errors;
suppress the attempted version before handoff so returning cannot cause a loop.
A narrow patch disables the flexible native listener and its eager manager
initialization; completing one still requires the JS safety-gated handoff.
iOS uses Expo Application's verified production environment, the existing validated
listing lookup and explicit external App Store navigation, never a StoreKit sheet.

Keep the custom Android activity service: periodic background tasks do not replace
its ongoing notification and Headless JS behavior. Keep the ANR mitigation directly
after MainActivity's superclass call. Expo's Activity listener is invoked inside
the superclass delegate path, so identical timing has not been established.

Apply general dependency fixes with version-pinned patch-package diffs. Keep FOSS
transformations flavor-specific and build their modified dependencies from source.
Remove patches only when stable compatible upstream code preserves every fix.
Prefer awaited file writes; synchronous crash recording is retained because the
fatal handler must record before delegating. Load optional models only on demand;
active-conversation prewarming retains its latency purpose.

Official Expo skills stay developer-installed. MCP is optional, development-only,
explicitly enabled and absent from normal CI. Local build/log/device tools remain
sufficient without an Expo account or new recurring service.

## Consequences

The custom store-update module is removed. Sharing, Sherpa and legacy-update safety fixes, the activity
service and narrowly justified build plugins remain. Updating the SDK requires the
full existing gate and signed native/device acceptance; no native E2E framework
or mandatory CI job is added. FOSS publication remains subject to its existing
licensing and reproducibility requirements.

## Alternatives considered

- Flexible updates: the maintained package auto-completes downloads, which can
  interrupt later unsaved work. Immediate Play UI makes that tradeoff explicit.
- Replacing Android widgets: preserving installed receiver identities and headless
  snapshots is not established by SDK 58's new widget renderer.
- Replacing the MainActivity edit with a lifecycle listener: callback order differs.
- Removing every patch or taking prereleases: loses required safety/JNI fixes.
- Migrating custom modules to experimental APIs or adding a state/UI framework:
  adds unrelated churn without removing an existing required responsibility.

## Rollback

Revert the coordinated dependency/adapter/configuration commits with the lockfile
and regenerate native projects. Existing credentials, models and preferences stay
valid. After publication, release a forward fix with higher build numbers.

## Follow-up

- [x] Complete the existing automated gate and Android release/FOSS builds (local debug signing only).
- [ ] Complete the iOS distribution archive and signing checks.
- [ ] Complete signed Play immediate-update and public App Store acceptance.
- [ ] Complete physical-device voice, keyboard, widget and notification acceptance.
- [ ] Obtain explicit human validation of the changed E2E update contract.
