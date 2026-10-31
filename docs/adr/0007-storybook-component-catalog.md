# ADR 0007: Storybook for reusable components

- Status: Superseded by ADR 0013
- Date: 2026-10-29
- Deciders: maintainers
- Supersedes: —
- Related: [Storybook guide](../design/storybook.md), [Design system](../design/design-system.md), [Component inventory](../design/component-inventory.md)

## Context

Shared controls are exercised through full app flows. Reviewing a button,
field, switch, or state treatment currently requires booting the app, connecting
to a fake server, and navigating to the right surface. That makes it hard to
review edge states (disabled, error, long translation, dark theme, narrow width)
and easy to duplicate a control because the existing one is not discoverable.
The app already runs on web through `react-native-web`, so a browser-based
catalog is feasible without adding a native dependency to the app.

## Decision

Use Storybook as the catalog for reusable presentation components.

- Storybook runs on the web with `@storybook/react-vite` and aliases
  `react-native` to `react-native-web`.
- Stories are co-located with reusable primitives and shared controls
  (`components/**/*.stories.tsx`).
- The preview provides the real appearance provider and Paper theme, with
  light/dark and accent controls.
- Stories cover reusable presentation, not provider orchestration or full
  screens. Provider-coupled surfaces remain covered by E2E flows.
- A story must render the production component, not a parallel copy.
- `npm run build:storybook` is the catalog build check. It is not part of the
  app bundle or the E2E export.

## Consequences

- Shared controls can be reviewed in isolation across themes and states.
- The catalog becomes stale if stories are not updated with the component; the
  design-system workflow requires a story for new shared primitives.
- Web-only Storybook cannot prove native behavior. Physical-device checks remain
  required for native modules, gestures, keyboard, and accessibility.
- The Storybook dependency set is development-only and does not ship in the app.

## Alternatives considered

- **Storybook for React Native on device:** closest to production, but slower to
  review and harder to automate on this repository's CI hosts.
- **No catalog:** no new dependencies, but keeps shared controls undiscoverable
  and edge states under-reviewed.
- **Screenshot-only gallery:** useful for visual review, but does not exercise
  props, state, or accessibility semantics.
- **A custom in-app gallery:** duplicates Storybook's navigation, controls, and
  docs with more maintenance.

## Follow-up

- [x] Add the web Storybook configuration and preview decorators.
- [x] Add stories for the initial shared primitives.
- [ ] Add a story when a new reusable primitive or shared control is introduced.
