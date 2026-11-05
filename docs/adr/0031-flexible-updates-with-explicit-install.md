# ADR 0031: Flexible store updates with explicit install

- Status: Superseded by ADR 0036
- Date: 2026-11-05
- Deciders: maintainers
- Supersedes: [ADR 0017](0017-native-defaults-and-prebuilt-engines.md)
- Related: [App updates](../product/app-updates.md), [Library decisions](../engineering/library-extraction.md), `patches/expo-in-app-updates+0.13.0.patch`

## Context

Immediate-only updates interrupt the user with a blocking Play flow at download
time. Play's flexible mode downloads in the background while the app stays
usable, but `expo-in-app-updates` 0.13.0 installs the moment a flexible download
finishes (`completeUpdate()` inside the `DOWNLOADED` listener), so the app
cannot gate the restart behind its unsaved-work, route and foreground blockers.
ADR 0017 therefore standardized on unmodified upstream behavior with explicit
immediate requests only.

## Decision

Patch `expo-in-app-updates` 0.13.0 with `patch-package` and keep everything else
upstream. The patch stops the automatic install on download completion, reports
a finished download from `checkForUpdate`, and reports the store version for an
interrupted immediate update so recovery keeps the offered version. The adapter
(`shared/platform/android-app-updates.ts`) prefers immediate and falls back to
flexible when Play only permits that type. A finished download surfaces a
Restart & install banner; the install runs only after an explicit tap
re-verifies safety. JS never auto-installs. The `llama.rn` pinning, FOSS
exclusions, SDK baseline and remaining ownership from ADR 0017 stay in force.

## Consequences

Flexible downloads no longer restart the app during unsafe work, and updates
remain offerable where Play disallows immediate mode. The patch is owned
locally: every `expo-in-app-updates` upgrade must re-verify it, and signed
Play internal-track acceptance must cover download, kill-during-download,
busy-at-completion and install. Flexible mode lets users defer the install
indefinitely; availability-gated protocol changes must account for stale
clients. iOS keeps explicit App Store navigation.

## Alternatives considered

- **Keep immediate-only:** rejected; it blocks the user at download time and
  suppresses offers where Play only permits flexible updates.
- **Auto-install on download completion:** rejected; the restart would bypass
  the app-side safety gates this change exists to protect.
- **Custom Android updater:** rejected in favor of the maintained bridge with
  one narrow patch.
- **Upstream contribution:** accepted as follow-up; drop the patch if upstream
  makes auto-complete optional.

## Follow-up

- [ ] Update the affected implementation docs.
- [ ] Add or update tests or fake-server coverage.
- [ ] Link this ADR from the change summary.
