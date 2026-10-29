# ADR 0008: Documentation information architecture and checks

- Status: Accepted
- Date: 2026-10-29
- Deciders: maintainers
- Supersedes: —
- Related: [Documentation router](../README.md), [ADR index](README.md), [AGENTS.md](../../AGENTS.md)

## Context

The documentation had grown into a flat `docs/` directory with architecture,
product behavior, design, testing, release, and deferred work mixed together.
Filenames were descriptive, but there was no task-based router, no per-section
index, and no durable place for decisions. Agents and contributors had to search
the whole tree, and moving a file silently broke links. The design material was
split between `docs/design-system.md`, a root `design-qa.md`, and a
`docs/design/` folder used for a single proposal.

## Decision

Organize documentation by purpose and make discoverability enforceable.

- Top-level sections: `architecture/`, `product/`, `design/`, `engineering/`,
  and `adr/`.
- `docs/README.md` is the task-based router and links every section.
- Each section has a `README.md` with an index, ownership map, rules, and
  related links.
- Design has a dedicated section covering the design system, component
  inventory, Storybook, QA process/log, and proposals.
- Decisions live in `docs/adr/` with an index and template; the workflow is
  part of `AGENTS.md`.
- `tests/vitest/docs.test.ts` checks that every doc is reachable from a README,
  relative Markdown links resolve, and ADRs are numbered, indexed, and shaped
  correctly.
- Documentation is updated in the same change as the behavior it describes.

## Consequences

- A contributor or agent can start from a task and reach the owning page in one
  or two links.
- Moving a doc requires updating links; the docs test catches the common cases.
- The section READMEs need maintenance, but they are short and stable.
- The ADR requirement adds a small cost to durable decisions and removes a much
  larger rediscovery cost.

## Alternatives considered

- **Keep the flat tree and add a better index:** less churn, but the index
  becomes a long list and design/architecture/release material still mixes.
- **One folder per feature:** good for product docs, but architecture and
  engineering concerns cut across features.
- **A generated docs site only:** useful for readers, but does not fix the
  source layout or enforce links.
- **Rely on search:** works for known terms, but not for "where do I start?" or
  "which doc owns this?"

## Follow-up

- [x] Move existing docs into the new sections and update references.
- [x] Add section READMEs, the router, ADRs, and the docs test.
- [ ] Keep new docs in the narrowest correct section.
