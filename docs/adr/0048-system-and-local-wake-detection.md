# ADR 0048: Retain System and On-device wake detection

- Status: Accepted
- Date: 2026-11-20
- Deciders: maintainers
- Supersedes: —
- Related: [Voice behavior](../product/functional-spec.md#chat-screen-detailed-behavior), [Voice validation](../engineering/voice-validation.md), [ADR 0017](0017-native-defaults-and-prebuilt-engines.md)

## Context

System voice could miss a phrase split between results or discard a lower
hypothesis before its final revision. Both Sherpa bridges could miss an
acoustic detection while draining a batch, and Android hid decode exceptions.

## Decision

Retain System voice for configurable wake phrases and keep the bundled English
phrases available through an explicit On-device download. Revise the System
wake segment with all available hypotheses and keep literal prefixes briefly
across segments. Read each Sherpa decode result before the next decode step.
Use existing capture owners, confirmation rules and local diagnostics.

## Consequences

Existing voice preferences and installed models work without migration.
System detection still depends on the recognizer returning a matching phrase.
On-device capture retains separate wake and command stages. Device acceptance
measures both stages before any acoustic threshold changes.

## Alternatives considered

- **Bundle the acoustic detector by default.** This adds installation weight
  and limits default wake phrases to the languages and tokens the model supports.
- **Add fuzzy matching or relax model thresholds.** These changes can trigger
  on ambient speech. Use the paired device and negative-audio trials to
  determine whether tuning is needed after the deterministic fixes.
