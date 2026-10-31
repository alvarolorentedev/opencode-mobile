# shared/ui/

Read the [design system](../../docs/design/design-system.md),
[Storybook guide](../../docs/design/storybook.md), and
[exact runtime exception](../../docs/architecture/feature-boundaries.md#shared-ui-runtime-exception).

Keep controls feature-independent; domain preference fields belong to features.
Reuse source-owned primitives, CVA and `cn()`. `shared/ui/theme/ui-tokens.json` is the sole token
source. Preserve provenance, accessibility, modal hosts, text scaling and keyboard/Back.
Only the exact existing portals/overlays/blockers in the architecture test may import
the specified `runtime/ui` symbols. No private runtime imports, additional bridge
context or duplicated state. The scope API cannot reach root composition or UI.

Keep stories beside production components; run shared UI tests, static checks,
Storybook build and affected existing flows. Native modal/keyboard acceptance needs
devices. Do not change a boundary policy to conceal a failure.
