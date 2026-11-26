# shared/ui/

Read the [design system](../../docs/design/design-system.md),
[Storybook guide](../../docs/design/storybook.md), and
[shared UI dependencies](../../docs/architecture/feature-boundaries.md#shared-ui-dependencies).

Keep controls feature-independent; domain preference fields belong to features.
Reuse source-owned primitives, CVA and `cn()`. `shared/ui/theme/ui-tokens.json` is the sole token
source. Preserve provenance, accessibility, modal hosts, text scaling and keyboard/Back.
Keep portal hosts and dismissal mechanics in shared controls. Size native portal
panels with flex stretch or `useOverlayWidth`, never percentage classes; web
keeps the Tailwind widths. Destructive actions run immediately; there are no
confirmation dialogs. Accept explicit
interaction registration callbacks where a feature needs them. Shared controls
use only shared dependencies.

Keep stories beside production components; run shared UI tests, static checks,
Storybook build and affected existing flows. Native modal/keyboard acceptance needs
devices. Do not change a boundary policy to conceal a failure.
