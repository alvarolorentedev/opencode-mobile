# ADR 0025: Truthful Live Activity progress and freshness

- Status: Proposed
- Date: 2026-11-01
- Deciders: fork implementation; upstream review pending
- Supersedes: Presentation and freshness policy in [ADR 0024](0024-opt-in-local-ios-live-activities.md); its opt-in, privacy, provisioning, and ownership decisions remain in force
- Related: [iOS parity](../product/parity/ios-widget.md), [Native integrations](../engineering/integrations-and-operations.md), [Validation strategy](../engineering/validation/strategy.md)

## Context

Personal Team device testing established that the native activity can be
installed and displayed without an App Group. The initial generic status and
full-size paused notice were not sufficiently useful: leaving the foreground
replaced information about the agent with information about the monitor.
Brief interruptions and actual background suspension also need different
treatment. Neither state proves that server-side work has stopped.

The existing notifications owner already observes normalized session families,
tool parts, and messages. V2 task lists are carried by tool inputs rather than a
session todo endpoint. Observations use a bounded message window, so missing
task lists or earlier tool activity cannot be reported as zero or reconstructed
with invented percentages.

## Decision

Separate agent state from observation freshness. Keep the last verified phase
and counts visible, and render paused/stale observation as secondary information
with an observation timestamp. Do not present stale information as newly live.
Foreground reconciliation, not merely returning to the foreground, establishes
fresh data again. Background execution remains local and bounded, not a keepalive.

Derive coarse work phases and optional progress from the existing normalized
observations. A known task list may supply completed/total progress; unknown
progress remains indeterminate. Do not infer the percentage of an entire agent
run from elapsed time, tool-call counts, or guessed stages. Do not sum known and
unknown plans into a misleading aggregate percentage.

The native dashboard uses compact status, elapsed time, real progress when known,
and bounded agent/tool counters. Terminal states remain explicit. Titles,
filenames, task descriptions, prompts, commands, replies, and credentials stay
out of the Lock Screen payload. All mutations remain inside the app. Reuse the
same presentation views in native rendering checks, not a second visual mock.

The optional test workflow distinguishes lightweight native presentation checks
from explicitly requested device archives. Cache safe compiler/download inputs
without skipping installation, compilation, or artifact validation. A SwiftUI
rendering harness is evidence for those views, not evidence that the full React
Native application launches or that actual system activity hosting works.

Remote delivery remains a separate, proposed integration. No unconsumed token
bridge, assumed Cloud Link endpoint, public relay, Apple credential, or new
background mode is introduced to make the local surface appear complete.
See the [remote-delivery proposal](../engineering/ios-live-activity-remote-delivery.md)
for the upstream decisions required before implementing that integration.

## Consequences

The free-account experience can be informative and polished while remaining
honest about stale observations. Device testing can cover real task progress,
layout, accessibility, routing, and lifecycle without paid push provisioning.
Continuous updates after suspension still require a provisioned sender and a
maintainer-agreed registration/aggregation boundary.

Additional content-state fields are optional so older local activities remain
decodable. Encoded content remains within the existing byte budget. The
connection-scoped owner, opaque aggregate cycle identities, dismissal behavior,
completion notifications, Android payload behavior, and default store builds
must remain unchanged.

## Alternatives considered

- **Replace the primary state with a paused message:** technically cautious but
  obscures useful last-known information and suggests the agent itself paused.
- **Continue displaying stale progress as live:** rejected because a local
  activity cannot establish server freshness after the app is suspended.
- **Fake a progress percentage or count missing history as zero:** rejected
  because neither reflects verified work.
- **Add an independent widget poller or speculative push registration API:**
  rejected because it duplicates ownership or depends on an unverified backend.

## Follow-up

- [ ] Review the native presentations in light/dark, long translations, and large text.
- [ ] Validate the new surface with actual work on a Personal Team iPhone.
- [ ] Agree remote-delivery ownership and perform provisioned background testing.
- [ ] Obtain upstream review before enabling the feature in default store builds.
