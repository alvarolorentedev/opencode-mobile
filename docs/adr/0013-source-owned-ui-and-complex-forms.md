# ADR 0013: Source-owned UI and complex forms

- Status: Accepted
- Date: 2026-10-31
- Deciders: maintainers
- Supersedes: ADR 0006, ADR 0007
- Related: [Design system](../design/design-system.md), [Storybook](../design/storybook.md), [Component inventory](../design/component-inventory.md)

## Context

This agent-maintained application needs conventional source components and one
predictable styling system across native and web. Its full accent palettes,
workspace-scoped overlays, complex authentication forms and specialized
renderers must survive replacement of the previous UI foundation.

## Decision

Use React Native Reusables' Uniwind registry as the source-owned component
foundation, Uniwind Free with Tailwind CSS v4 for static styling, and RN
Primitives for standard accessible interactions. Remove React Native Paper.

- Author presentation values only in `constants/ui-tokens.json`. Generate CSS;
  derive TypeScript/native renderer values from the same source.
- Existing persisted preferences own light/dark/system and the six accents.
  Appearance synchronizes Uniwind's light/dark variable sets and navigation.
- Use conventional compound APIs, CVA variants and `cn()`. Keep measured,
  animated, keyboard and third-party renderer styles at their existing boundary.
- Complex forms use React Hook Form and Zod, reusing domain validators.
  Pin the Zod resolver adapter to 5.2.2: resolver 6's optional stable-Effect
  peer conflicts with the protocol dependency's pinned Effect prerelease.
  Form drafts remain local; API requests, persistence and domain state retain
  their existing owners. Simple preferences remain immediate.
- Keep one default portal host and named hosts inside native modal windows.
  Preserve workspace context, topmost dismissal, update blockers and focus.
- Preserve the native slider, terminal DOM interaction layer, markdown renderer
  and FlashList behavior. They implement specialized platform behavior.
- Storybook keeps its web/Vite role and renders production components with
  actual appearance and portal providers. Native acceptance still needs devices.
- Registry updates are reviewed source diffs with upstream provenance and
  local adaptations. Never overwrite the source catalog automatically.
- Superseded ADRs retain historical source paths; documentation tests still
  validate their Markdown links, structure and indexing, but do not require
  historical inline implementation paths to exist forever.

## Consequences

Agents can reuse ordinary source components and form conventions without a
Paper compatibility layer or parallel token values. The application owns
upstream adaptations and must review component upgrades. Native keyboard,
accessibility, modal stacking and production/FOSS builds remain acceptance
requirements; web tests cannot certify them.

## Alternatives considered

- **Keep Paper:** retains the foundation the migration explicitly replaces.
- **A second styling engine or UI kit:** creates competing conventions.
- **Uniwind Pro:** unnecessary for the retained explicit animation and safe-area
  handling; the free engine supports the required Expo and Vite integration.
- **Generic form or overlay frameworks:** add indirection without another owner
  or consumer. Use focused local composition instead.
- **Replace the native slider with RN Primitives:** its native implementation
  does not provide drag handling, so replacement adds custom interaction code.

## Follow-up

- [x] Update the design system and agent guidance.
- [x] Add generation checks and update reusable-component stories.
- [ ] Complete physical-device and signed distribution acceptance before release.
