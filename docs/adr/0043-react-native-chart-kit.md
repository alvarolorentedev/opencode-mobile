# ADR 0043: ChartKit for the Mission Control usage chart

- Status: Accepted
- Date: 2026-11-09
- Deciders: maintainers
- Supersedes: —
- Related: [Mission Control components](../design/components/screens.md#mission-control), [Functional specification](../product/functional-spec.md#mission-control), [ADR 0042](0042-mission-server-aggregates.md)

## Context

Mission Control needs a standard bar chart for usage over time and a
calendar-style contribution chart for daily activity. The previous chart was a
small hand-built View/SVG composition. It handled axes and bar geometry locally,
which made labels, platform formatting and visual consistency the app's
responsibility.

Expo does not ship a chart package. A chart library must therefore be a
controlled dependency exception. It must keep the native surface unchanged, work
through react-native-web for Storybook and browser tests, and leave the existing
design tokens in control of colors and typography.

## Decision

Use `react-native-chart-kit@7.0.4` (ChartKit) for the Mission Control charts.

- The usage card uses the modern `/v2` `BarChart` for tokens and recorded cost.
- The contributions card uses a source-owned 30-square grid for the last 30 days
  of the daily `activity.steps` series returned by the session statistics
  endpoint. ChartKit's calendar heatmap is week-oriented and leaves a 30-day
  window mostly empty, so it is not used for this card.
- The library's free MIT surface is sufficient. Do not enable Pro-only charts or
  export APIs.
- Keep chart imports inside `features/sessions/ui/`. Pass an explicit theme
  derived from the app palette and measure the available width; the contribution
  grid does not add a second chart engine.
- Keep the existing card skeleton, range controls, totals and incomplete-data
  warning in the feature. ChartKit owns only the plot, axes and chart
  interaction.
- The grid shows daily steps because that is the daily series the server
  exposes. Daily conversation counts would require additional server support or
  many per-day reads.

## Consequences

The charts gain standard axes, labels, spacing, tap selection and tooltips while
the native dependency set stays unchanged: ChartKit uses the already-installed
`react-native-svg` and adds only the pure-JS `paths-js` package. Web and
Storybook must still be validated because ChartKit renders through
react-native-svg.

ChartKit version upgrades are reviewed source compatibility changes. A chart
that needs behavior outside the free surface, or a new chart type, requires a
new decision instead of a silent Pro or second-chart-library addition. The
30-day contribution window stays independent of the usage range selector.

## Alternatives considered

- **Keep the hand-built chart:** avoids a dependency but keeps axis math,
  platform formatting and visual polish in product code, and provides no
  contribution calendar.
- **Victory Native:** requires Skia, Worklets and a native/web rendering stack that
  is far larger than a two-chart screen needs.
- **Gifted Charts:** adds another chart dependency and styling/axis system with
  less certain web and accessibility behavior for this use case.
- **ChartKit ContributionGraph for 30 days:** its week-column calendar layout
  leaves most of the card width empty and made the compact 30-day card look
  unbalanced. The source-owned 10-by-3 grid fills the width with 30 cells.
- **Extra daily stats requests:** a calendar heatmap for conversations would need
  many sequential reads per server or a server-side daily conversation field.

## Follow-up

- [ ] Update the affected implementation docs.
- [x] Add or update tests or fake-server coverage.
- [x] Link this ADR from the change summary.
