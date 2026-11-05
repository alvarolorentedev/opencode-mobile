# ADR 0036: Flexible-first store updates with a Play urgency override

- Status: Accepted
- Date: 2026-11-05
- Deciders: maintainers
- Supersedes: [ADR 0031](0031-flexible-updates-with-explicit-install.md)
- Related: [App updates](../product/app-updates.md), [Library decisions](../engineering/library-extraction.md)

## Context

ADR 0031 added flexible downloads with an explicit install, but ordered the
adapter immediate-first. Because Play normally permits immediate updates, the
blocking flow stayed the default and the background download was effectively
unreachable. The overlay UX only appears when flexible is requested first.

## Decision

Request flexible first in `shared/platform/android-app-updates.ts`; fall back to
immediate only when Play refuses flexible, and keep immediate for Play update
priorities 4-5, which the console uses to mark an urgent release. The patch,
deferred install behind the safety gates, cooldowns, recovery and every other
clause of ADR 0031 remain in force unchanged.

## Consequences

Ordinary releases download in the background while the app stays usable and
install only after an explicit Restart tap. A maintainer can still force a
blocking update for one release by setting priority 4-5 in the Play Console;
the app reads that value from `serverPriority` on each check. Flexible-first
depends on `serverPriority` being returned by the patched bridge, so the adapter
tests pin normal and urgent priorities.

## Alternatives considered

- **Keep immediate-first from ADR 0031:** rejected; it hides the flexible path
  on every device where Play allows immediate updates.
- **Always flexible, ignoring priority:** rejected; it removes the Play Console
  emergency lever without an app-side replacement.
- **App-side forced-update policy:** rejected for now; the existing store
  priority is already the configured signal.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add or update tests.
- [ ] Link this ADR from the change summary.
