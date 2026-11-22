# OpenCode Mobile Documentation

This directory documents the app as it exists today: current behavior, current
boundaries and the reasons behind them. It is not aspirational product docs.

Read only the section that owns your task.

## Start here

| I need to… | Read |
| --- | --- |
| Use a step-by-step recipe | [Task recipes](engineering/task-recipes.md) |
| Find a feature or change an import boundary | [Feature ownership](architecture/feature-boundaries.md) |
| Understand the runtime, layers or boot flow | [Architecture overview](architecture/overview.md) |
| Change state, refresh, persistence or sessions | [State and data](architecture/state-and-data.md#state-ownership-overview) |
| Change an endpoint, event or compatibility boundary | [API contract](architecture/api-contract.md) + [ADR 0003](adr/0003-v2-first-protocol-boundary.md) |
| Work on SSE, polling, offline or slow networks | [Network resilience](architecture/network-resilience.md) |
| Work on logs, traces, metrics or telemetry | [Observability](architecture/observability.md) |
| Add or change a user-visible workflow | [Functional specification](product/functional-spec.md) |
| Build UI, add a component or settings row | [Design system](design/design-system.md) + [Component inventory](design/component-inventory.md) |
| Change native config, build or release | [Development](engineering/development.md) + [Integrations and operations](engineering/integrations-and-operations.md) |
| Run or extend tests | [Validation index](engineering/testing-and-validation.md) + [Strategy](engineering/validation/strategy.md#test-selection-matrix) |
| Add an architectural decision | [ADR process](adr/README.md) |
| Check deliberately deferred work | [Known gaps](engineering/known-gaps.md) |

## Sections

| Section | Purpose | Index |
| --- | --- | --- |
| Architecture | How the app is composed, where state lives, and how it talks to OpenCode | [architecture/README.md](architecture/README.md) |
| Product | What the app does for users, feature by feature | [product/README.md](product/README.md) |
| Design | Visual language, reusable components, Storybook, and design QA | [design/README.md](design/README.md) |
| Engineering | Local setup, validation, operations, release, and deferred engineering work | [engineering/README.md](engineering/README.md) |
| Decisions | Architecture Decision Records (ADRs) and the decision workflow | [adr/README.md](adr/README.md) |

## First time in this repo (read once)

1. [Architecture overview § High-Level Shape](architecture/overview.md#high-level-shape)
2. [State and data § State Ownership Overview](architecture/state-and-data.md#state-ownership-overview)
3. [Component inventory](design/component-inventory.md)
4. [Validation strategy](engineering/validation/strategy.md)
5. [ADR index](adr/README.md)

This onboarding path is not a per-task requirement.

## Documentation rules

- Update docs in the same change as the behavior. Architecture, behavior,
  protocol, flow and design-contract changes are not complete without the
  matching doc.
- Record decisions in ADRs; do not bury reasons in code comments or PR text.
- Keep one source of truth. Link to the owning page instead of duplicating
  command lists, endpoint tables or token values.
- Keep the router current. Every doc must be reachable from a section README.
  `tests/vitest/docs.test.ts` enforces links and ADR shape.
- Use relative Markdown links.
- State status near the top: proposals and deferred work say so; implementation
  docs describe shipped behavior.
- Keep it lean. Remove historical validation logs, duplicated narratives and
  local artifact paths instead of archiving them.
- ADRs are immutable. Once accepted, supersede with a new record and update the
  index; never rewrite the reasoning.

## Scope notes

- This documentation covers the mobile app implementation, not OpenCode server
  internals.
- Descriptions come from the source and deterministic fake-server fixtures.
  Platform limits are stated exactly. Visual acceptance evidence belongs in the
  PR or design review, not a committed history log.
