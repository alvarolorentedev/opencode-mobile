# ADR 0001: Record architecture decisions as ADRs

- Status: Accepted
- Date: 2026-10-29
- Deciders: maintainers
- Supersedes: —
- Related: [ADR index](README.md), [documentation router](../README.md)

## Context

Architecture decisions were spread across implementation docs, pull-request
descriptions, code comments, and commit history. The implementation docs explain
what the app does, but they do not consistently explain why a boundary exists
or which alternatives were rejected. That makes it easy to re-open settled
questions, and it makes agent-assisted changes riskier because an agent can
"improve" a deliberate constraint without seeing the reason.

## Decision

Use Architecture Decision Records under `docs/adr/`.

- Every decision that changes a boundary, selects a durable approach, or
  rejects a viable alternative gets a numbered ADR.
- ADRs use the [template](template.md) and are indexed in the
  [ADR README](README.md).
- ADRs are immutable after acceptance except for status changes and links. A
  replacement decision gets a new ADR and marks the old one superseded.
- `AGENTS.md` and the documentation workflow require an ADR when the trigger
  applies.
- `tests/vitest/docs.test.ts` validates ADR numbering, required sections, and
  index coverage.

## Consequences

- Future maintainers can find the reason for a boundary without reconstructing
  it from code or chat history.
- Changes carry a small documentation cost when they make a durable choice.
- Agents have an explicit instruction to check and add ADRs, which reduces
  accidental reversals.
- The ADR set must be maintained; stale statuses are worse than no ADR.

## Alternatives considered

- **Pull-request descriptions only:** close to the change, but hard to discover
  later and often lost when the repository is mirrored.
- **A wiki:** easy to edit, but drifts from the code and is not reviewed with
  the change.
- **Code comments only:** useful for local detail, but cannot compare
  alternatives or describe system-wide consequences.
- **No formal record:** preserves speed, but repeats the current problem.

## Follow-up

- [x] Add the ADR directory, template, and index.
- [x] Add the workflow to `AGENTS.md` and the documentation router.
- [x] Add the documentation contract test.
