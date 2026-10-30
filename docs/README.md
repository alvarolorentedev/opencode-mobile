# OpenCode Mobile Documentation

This directory is the implementation reference for `opencode-mobile`. It
documents the app as it exists in the repository today: current behavior,
current boundaries, and the reasons behind them. It is not aspirational product
documentation.

Use this page as the router. Start with the task you are doing, then follow the
section README. Each section has a short index and a "where does this live?"
map so agents do not have to guess from filenames.

## Start here

Read the section named below, not the whole file. Do not preload unrelated
sections; the reference docs are large on purpose.

| I need to… | Read |
| --- | --- |
| Use a step-by-step recipe | [Task recipes](engineering/task-recipes.md) |
| Understand the runtime, layers, and boot flow | [Architecture overview](architecture/overview.md) |
| Change provider state, refresh, persistence, or session behavior | [State and data](architecture/state-and-data.md#state-ownership-overview) + [Architecture overview § Module Map](architecture/overview.md#module-map) |
| Change an OpenCode endpoint, event, or compatibility boundary | [API contract](architecture/api-contract.md) + [ADR 0003](adr/0003-v2-first-protocol-boundary.md) |
| Work on SSE, polling, reconnect, offline, or slow networks | [Network resilience](architecture/network-resilience.md) |
| Add or change a user-visible workflow | [Functional specification](product/functional-spec.md) |
| Build or restyle UI | [Design system](design/design-system.md) + [Component inventory](design/component-inventory.md) |
| Add or change a reusable component | [Design system](design/design-system.md) + [Storybook guide](design/storybook.md) |
| Add or change a translated string | [Task recipes § Translations](engineering/task-recipes.md#translations) + [Design system](design/design-system.md#accessibility-localization-and-feature-acceptance) |
| Add or change a settings section or row | [Task recipes § Settings](engineering/task-recipes.md#settings-section-or-row) + [Component inventory § Settings](design/components/settings.md#settings-components) |
| Work on notifications or terminal | [Functional specification § Notifications](product/functional-spec.md#notifications-behavior) + [Component inventory § Screens](design/components/screens.md#screen-controllers) |
| Work on projects or worktrees | [Functional specification § Journeys](product/functional-spec.md#primary-user-journeys) + [State and data § Project](architecture/state-and-data.md#project-and-session-identity-state) |
| Work on sharing or widgets | [Functional specification § Sharing](product/functional-spec.md#android-inbound-sharing) + [iOS share parity](product/parity/ios-share.md) |
| Work on Cloud Link / remote pairing | [Cloud Link](product/cloud-link.md) |
| Work on voice input or spoken replies | [Design system](design/design-system.md) + [Voice validation](engineering/voice-validation.md) |
| Change native configuration, build, or release | [Development](engineering/development.md) + [Integrations and operations](engineering/integrations-and-operations.md) |
| Run or extend tests, or choose a test level | [Validation index](engineering/testing-and-validation.md) + [Validation strategy](engineering/validation/strategy.md#test-selection-matrix) |
| Add a feature that needs an architectural decision | [ADR process](adr/README.md) |
| Check deliberately deferred work | [Known gaps](engineering/known-gaps.md) |
| Evaluate a library or extraction | [Library extraction](engineering/library-extraction.md) |

## Sections

| Section | Purpose | Index |
| --- | --- | --- |
| Architecture | How the app is composed, where state lives, and how it talks to OpenCode | [architecture/README.md](architecture/README.md) |
| Product | What the app does for users, feature by feature | [product/README.md](product/README.md) |
| Design | Visual language, reusable components, Storybook, and design QA | [design/README.md](design/README.md) |
| Engineering | Local setup, validation, operations, release, and deferred engineering work | [engineering/README.md](engineering/README.md) |
| Decisions | Architecture Decision Records (ADRs) and the decision workflow | [adr/README.md](adr/README.md) |

## Recommended reading paths

### First time in this repo (read once)

1. [Architecture overview § High-Level Shape](architecture/overview.md#high-level-shape)
2. [State and data § State Ownership Overview](architecture/state-and-data.md#state-ownership-overview)
3. [Component inventory](design/component-inventory.md)
4. [Validation strategy](engineering/validation/strategy.md)
5. [ADR index](adr/README.md)

This onboarding path is read once. It is not a per-task requirement.

### UI or design change

1. [Design system](design/design-system.md)
2. [Component inventory](design/component-inventory.md) and the matching area file
3. [Storybook guide](design/storybook.md) when the control is reusable
4. [Design QA process](design/qa/README.md)
5. [Functional specification](product/functional-spec.md) for the affected flow

### Protocol or provider change

1. [Architecture overview § Module Map](architecture/overview.md#module-map)
2. [State and data § State Ownership Overview](architecture/state-and-data.md#state-ownership-overview)
   and the owning domain section
3. [API contract](architecture/api-contract.md)
4. [Network resilience](architecture/network-resilience.md) when transport is involved
5. [Validation strategy](engineering/validation/strategy.md)

### Release or operations change

1. [Development](engineering/development.md)
2. [Testing overview](engineering/testing-overview.md)
3. [Integrations and operations](engineering/integrations-and-operations.md)
4. [App updates](product/app-updates.md) and [F-Droid](engineering/fdroid.md) when relevant

## Documentation rules

- **Update docs in the same change as the behavior.** A code change that alters
  architecture, behavior, a protocol, a user flow, or a design contract is not
  complete until the matching doc is updated.
- **Record decisions in ADRs.** If a change selects an approach, changes a
  boundary, or rejects a viable alternative, add an ADR under `docs/adr/`.
  Do not bury the reason in a code comment or a pull-request description.
- **Keep one source of truth.** Do not duplicate full command lists, endpoint
  tables, or token values across docs. Task recipes may name only the commands
  that task needs; link to the owning page for the rest.
- **Keep the router current.** Every doc must be reachable from this page or a
  section README. `tests/vitest/docs.test.ts` enforces links and ADR shape.
- **Use relative links.** Link to files with relative Markdown links so the
  tree stays portable.
- **State status.** Proposals and deferred work must say so near the top;
  implementation docs describe shipped behavior.
- **Keep it lean.** Remove historical validation logs, duplicated narratives,
  and local artifact paths instead of archiving them. If a fact is encoded in a
  test or spec, link to the owner rather than repeating it.
- **ADRs are immutable.** Once accepted, an ADR is never rewritten; supersede it
  with a new record and update the index.

## Scope notes

- This documentation covers the mobile app implementation, not OpenCode server
  internals.
- Descriptions are based on the source code and deterministic fake-server
  fixtures in this repository.
- Platform-dependent behavior is described exactly, including limitations.
- Visual acceptance evidence belongs in the pull request or design review, not
  in a committed historical log. It is not a substitute for physical-device,
  screen-reader, or store acceptance.
