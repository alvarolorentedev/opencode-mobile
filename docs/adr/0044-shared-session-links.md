# ADR 0044: Shared OpenCode session links

- Status: Accepted
- Date: 2026-11-17
- Deciders: maintainers
- Supersedes: —
- Related: [Issue #111](https://github.com/alvarolorentedev/opencode-mobile/issues/111), [native session links](../engineering/integrations-and-operations.md#session-deep-links)

## Context

Other OpenCode clients produce `opencode://session/<id>` links. OpenCode Mobile
registers its own scheme, which Expo Sharing also uses for its callback.

## Decision

Register the shared scheme as an inbound session alias. Android scopes its
intent filter to the `session` host. On both platforms the native intent handler
extracts a single URL-safe session ID, discards query parameters and fragments,
and hands the ID to the existing session resolver. The resolver uses the
current connection and its default project for this form.

## Consequences

The alias can navigate to an existing session. It carries no instructions to
submit a prompt or configure a server. Native builds are required to register
the alias. When multiple installed apps claim the shared scheme, the OS
controls which app receives it.

## Alternatives considered

- **Add both schemes at the top level of the Expo config.** Expo Sharing reads
  the top-level value as its Android callback scheme. Platform-specific
  registration preserves that single value and scopes Android delivery.

## Follow-up

- [x] Add native intent routing regression coverage.
- [ ] Verify cold and warm link delivery on rebuilt Android and iOS apps.
