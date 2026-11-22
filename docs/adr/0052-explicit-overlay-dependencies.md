# ADR 0052: Feature ownership and explicit overlay dependencies

- Status: Accepted
- Date: 2026-11-22
- Deciders: maintainers
- Supersedes: ADR 0015
- Related: [Feature boundaries](../architecture/feature-boundaries.md), [App core](0051-app-core-state-tiers.md), [UI foundation](0013-source-owned-ui-and-complex-forms.md), [App updates](../product/app-updates.md)

## Context

Feature ownership puts UI and behavior with the product domain and keeps
shared controls independent. The previous portal exception let controls recover
a caller's workspace through an application runtime import. It also tied
standalone sheets and pickers to app-update orchestration. ADR 0051 makes
workspace targets explicit and gives the app core ownership of selection.

## Decision

Keep Expo Router entrypoints in `app/`, domain implementation and colocated
tests in `features/`, cross-feature lifecycle in `runtime/`, device modules in
`modules/`, and feature-independent contracts and controls in `shared/`.
Preserve the named public feature APIs, acyclic dependency policy, route
boundaries, and separate app, connection, and project ownership.

Retained Settings and Terminal panes pass their composite workspace target to
the feature selectors and any portalled children. Shared portals keep the
existing default and named native hosts, dismissal order, keyboard handling,
and platform accessibility behavior.

The Updates feature supplies an interaction registration callback through its
control wrappers. Shared controls register on open and release on close or
unmount. Other callers can supply callbacks without an app update owner.
Shared modules import neither feature nor runtime code.

## Consequences

The architecture test checks the shared import direction without an allowlist.
Feature composition supplies the target and interaction lifetime together with
the rest of the overlay's props. Runtime data and native host selection retain
their existing owners. The change requires no persisted data conversion.

## Alternatives considered

- **Shared workspace context:** moving the scope carrier would keep a runtime
  identity in generic controls.
- **New portal bridge:** a bridge would add a second scope carrier and require
  coordination with the native modal host.
- **Per-screen update state:** several screens and modals can be active when the
  update policy evaluates them.

## Follow-up

- [x] Update feature boundaries and the app-update implementation reference.
- [x] Enforce the shared dependency direction in architecture tests.
- [ ] Verify native overlay, keyboard and Back behavior at the Phase E checkpoint.
