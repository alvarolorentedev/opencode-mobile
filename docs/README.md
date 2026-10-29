# OpenCode Mobile Documentation

This directory is the implementation reference for `opencode-mobile`. It
documents the app as it exists in the repository today: current behavior,
current boundaries, and the reasons behind them. It is not aspirational product
documentation.

Use this page as the router. Start with the task you are doing, then follow the
section README. Each section has a short index and a "where does this live?"
map so agents do not have to guess from filenames.

## Start here

| I need to… | Read |
| --- | --- |
| Understand the runtime, layers, and boot flow | [Architecture overview](architecture/overview.md) |
| Change provider state, refresh, persistence, or session behavior | [State and data](architecture/state-and-data.md) + [Architecture overview](architecture/overview.md) |
| Change an OpenCode endpoint, event, or compatibility boundary | [API contract](architecture/api-contract.md) + [ADR 0003](adr/0003-v2-first-protocol-boundary.md) |
| Work on SSE, polling, reconnect, offline, or slow networks | [Network resilience](architecture/network-resilience.md) |
| Add or change a user-visible workflow | [Functional specification](product/functional-spec.md) |
| Build or restyle UI | [Design system](design/design-system.md) + [Component inventory](design/component-inventory.md) |
| Add or change a reusable component | [Design system](design/design-system.md) + [Storybook guide](design/storybook.md) |
| Add a feature that needs an architectural decision | [ADR process](adr/README.md) |
| Set up the app, build, or release | [Development](engineering/development.md) |
| Run or extend tests | [Testing and validation](engineering/testing-and-validation.md) + [Testing overview](engineering/testing-overview.md) |
| Work on Cloud Link / remote pairing | [Cloud Link](product/cloud-link.md) |
| Work on voice input or spoken replies | [Design system](design/design-system.md) + [Voice validation](engineering/voice-validation.md) |
| Check deliberately deferred work | [Known gaps](engineering/known-gaps.md) |
| Evaluate a library or extraction | [Library extraction](engineering/library-extraction.md) |

## Sections

| Section | Purpose | Index |
| --- | --- | --- |
| Architecture | How the app is composed, where state lives, and how it talks to OpenCode | [architecture/README.md](architecture/README.md) |
| Product | What the app does for users, feature by feature | [product/README.md](product/README.md) |
| Design | Visual language, reusable components, Storybook, UX proposals, and design QA | [design/README.md](design/README.md) |
| Engineering | Local setup, validation, operations, release, and deferred engineering work | [engineering/README.md](engineering/README.md) |
| Decisions | Architecture Decision Records (ADRs) and the decision workflow | [adr/README.md](adr/README.md) |

## Recommended reading paths

### New agent or contributor

1. [Architecture overview](architecture/overview.md)
2. [State and data](architecture/state-and-data.md)
3. [Component inventory](design/component-inventory.md)
4. [Testing and validation](engineering/testing-and-validation.md)
5. [ADR index](adr/README.md)

### UI or design change

1. [Design system](design/design-system.md)
2. [Component inventory](design/component-inventory.md)
3. [Storybook guide](design/storybook.md)
4. [Design QA log](design/qa/log.md)
5. [Functional specification](product/functional-spec.md) for the affected flow

### Protocol or provider change

1. [Architecture overview](architecture/overview.md)
2. [State and data](architecture/state-and-data.md)
3. [API contract](architecture/api-contract.md)
4. [Network resilience](architecture/network-resilience.md)
5. [Testing and validation](engineering/testing-and-validation.md)

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
- **Keep one source of truth.** Do not duplicate command lists, endpoint
  tables, or token values across docs. Link to the owning page instead.
- **Keep the router current.** Every doc must be reachable from this page or a
  section README. `tests/vitest/docs.test.ts` enforces links and ADR shape.
- **Use relative links.** Link to files with relative Markdown links so the
  tree stays portable.
- **State status.** Proposals and deferred work must say so near the top;
  implementation docs describe shipped behavior.

## Scope notes

- This documentation covers the mobile app implementation, not OpenCode server
  internals.
- Descriptions are based on the source code and deterministic fake-server
  fixtures in this repository.
- Platform-dependent behavior is described exactly, including limitations.
- `docs/design/qa/log.md` records visual acceptance evidence; it is not a
  substitute for physical-device, screen-reader, or store acceptance.
