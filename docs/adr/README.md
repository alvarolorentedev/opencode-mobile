# Architecture Decision Records

ADRs capture decisions that are expensive to reverse or that shape how future
changes are made. They explain **why** the code is the way it is. The rest of
`docs/` explains **what** the code does.

## When to write an ADR

Write one when a change:

- selects a framework, transport, storage model, or protocol boundary
- changes ownership between `app/`, `components/`, `providers/`, `lib/`, or
  `providers/services/`
- adds or removes a compatibility path or a supported platform
- establishes a design-system primitive, token family, or accessibility policy
- rejects a viable alternative for a reason future maintainers need to know
- changes the documentation or decision workflow itself

Do not write an ADR for a routine bug fix, a local refactor that preserves
boundaries, or a copy change. If you are unsure, ask whether a future
maintainer would otherwise re-litigate the choice.

## Workflow

1. Copy [template.md](template.md) to
   `docs/adr/NNNN-short-kebab-title.md`, using the next four-digit number.
2. Fill in context, decision, consequences, and alternatives. Keep it short and
   concrete; link to code and docs instead of duplicating them.
3. Add the ADR to the index below in the same change.
4. Link the ADR from the affected implementation doc and mention it in the
   change summary.
5. If a later decision replaces it, set the old status to `Superseded by ADR
   NNNN` and add the new ADR. Do not rewrite history.

`tests/vitest/docs.test.ts` checks ADR numbering, required sections, index
coverage, and documentation links.

## Status values

| Status | Meaning |
| --- | --- |
| `Proposed` | Under discussion; not yet binding |
| `Accepted` | Current decision |
| `Superseded by ADR NNNN` | Replaced; kept for history |
| `Deprecated` | No longer recommended, but not directly replaced |
| `Rejected` | Considered and declined |

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions as ADRs | Accepted |
| [0002](0002-provider-centric-orchestration.md) | Provider-centric domain orchestration | Accepted |
| [0003](0003-v2-first-protocol-boundary.md) | V2-first protocol boundary with isolated V1 compatibility | Accepted |
| [0004](0004-sse-with-polling-fallback.md) | SSE primary with polling fallback | Accepted |
| [0005](0005-thin-routes-and-presentational-components.md) | Thin routes and presentational components | Accepted |
| [0006](0006-semantic-design-tokens-and-paper.md) | Semantic design tokens with React Native Paper | Accepted |
| [0007](0007-storybook-component-catalog.md) | Storybook for reusable components | Accepted |
| [0008](0008-documentation-information-architecture.md) | Documentation information architecture and checks | Accepted |
| [0009](0009-agent-first-documentation-routing.md) | Agent-first documentation routing and drift checks | Accepted |

## Template

Use [template.md](template.md). Keep the front matter fields (`Status`, `Date`,
`Deciders`, `Supersedes`, `Related`) so the index and checks stay useful.

## Related

- [Documentation router](../README.md)
- [Architecture](../architecture/README.md)
- [Design](../design/README.md)
- [Engineering](../engineering/README.md)
