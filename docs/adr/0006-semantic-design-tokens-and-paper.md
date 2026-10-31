# ADR 0006: Semantic design tokens with React Native Paper

- Status: Superseded by ADR 0013
- Date: 2026-10-29
- Deciders: maintainers
- Supersedes: —
- Related: [Design system](../design/design-system.md), [Design section](../design/README.md)

## Context

The app supports system/light/dark modes and six accent presets. Settings,
chat, projects, terminal, onboarding, and Cloud Link all need consistent
surfaces, text, borders, status colors, and control sizes. Literal colors and
one-off control styling had produced inconsistent contrast and made new themes
expensive to add. A custom component kit would duplicate accessible primitives
that already work on iOS, Android, and web.

## Decision

Use semantic design tokens with React Native Paper as the component foundation.

- `constants/theme.ts` owns semantic palette roles and platform font families.
- `constants/appearance.ts` owns theme modes and accent presets.
- `constants/paper-theme.ts` maps the palette into Paper's theme.
- `constants/design-tokens.ts` owns spacing, shape, and minimum control sizes.
- Components resolve colors through `usePalette()` and Paper components; they do
  not read `Colors.light` directly or hard-code literal colors.
- Keep platform fonts; do not add a font dependency.
- Shared settings rows and controls (`SettingSwitchRow`, `SettingSelectField`,
  `SettingButton`, `SettingTextInput`, `SettingSlider`, `SettingsDisclosure`)
  are the default building blocks for settings-like surfaces.
- Status always has text or an icon in addition to color. Disabled state keeps
  its label, accessible state, and prerequisite hint; opacity alone is not
  enough.

## Consequences

- New screens inherit theme, contrast, and control sizing automatically.
- A new color or spacing value requires a token change and a design-system
  update, not a local literal.
- Paper's platform behavior remains the baseline, so custom controls need a
  documented reason and accessible semantics.
- Visual QA must cover light/dark, accent presets, large text, narrow widths,
  and keyboard states.

## Alternatives considered

- **Tailwind or a CSS-first system:** poor fit for React Native's style model
  and Paper integration.
- **A fully custom component kit:** more control, but duplicates accessible
  primitives and increases maintenance.
- **Per-screen palettes:** fast locally, but breaks contrast and theme
  consistency.
- **A custom font family:** stronger brand control, but adds loading, fallback,
  and platform-metric risk without solving a current usability problem.

## Follow-up

- [x] Document the token sources and interaction patterns.
- [x] Add a Storybook catalog for shared primitives.
- [ ] Keep contrast tests and the design-system checklist current.
