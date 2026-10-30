# ADR 0010: Risk-based validation and selective PR E2E

- Status: Superseded by ADR 0011
- Date: 2026-10-30
- Deciders: maintainers
- Supersedes: —
- Related: [Validation strategy](../engineering/validation/strategy.md), [E2E flows](../engineering/validation/e2e.md), [AGENTS.md](../../AGENTS.md), [`scripts/ci/validation-map.mjs`](../../scripts/ci/validation-map.mjs)

## Context

The full Playwright suite is the slowest part of validation. At the time of the
decision it contains about 170 expanded tests and takes roughly 5 minutes of
test execution on four workers, plus about 75 seconds for the web export and
job overhead. Running it on every pull request is safe but makes agent feedback
slow and duplicates work when the same commit is later validated on `main` and
again on its release tag.

The repository is public, so standard GitHub-hosted runner minutes are free.
Wall-clock latency, release reliability, and avoidable compute are still real
costs. A solo maintainer and community contributors need a gate that is fast
for routine changes but still catches shared-contract regressions before a
release.

## Decision

Select E2E coverage by risk, but keep the full suite at the integration and
release boundaries.

- Pull requests run the critical `@smoke` set plus the specs selected from the
  changed paths. Shared contracts, unknown paths, protocol/provider code,
  test infrastructure, dependencies, and build configuration run the full
  suite.
- Every code-bearing push to `main` runs the full suite. Documentation-only
  pushes run static checks only.
- Release tags must point to a commit whose full static + E2E validation
  already succeeded on `main`. A tag does not rerun the suite; an emergency
  `force_validate` input runs the complete gate instead.
- Android and FOSS release builds run in parallel after the gate; a release
  preparation job creates the GitHub Release once before both uploads.
- E2E retries remain zero. Flakes are fixed with deterministic clocks,
  readiness signals, per-test fake-server resets, and atomic assertions, not
  with retries or larger timeouts.
- The change-to-spec mapping lives in `scripts/ci/validation-map.mjs` and is
  covered by `tests/vitest/validation-selection.test.ts`. Unknown mappings
  fail safe to the full suite.
- A required `validate / gate` check normalizes the conditional jobs. A skipped
  E2E job is accepted only when the change classification selected no E2E.

## Consequences

Routine PRs get feedback in roughly 3–5 minutes instead of 8–10. Release tags
stop duplicating the full suite, and the Android/FOSS critical path is the
longer of the two builds rather than their sum. Full `main` validation remains
the backstop when a selective PR misses a cross-area regression.

The selector must be updated when a new domain or spec is added. Raising the
E2E budget in `tests/e2e/budget.json`, adding a spec file, or changing a shared
contract is an explicit review decision. The release process must wait for the
`main` validation before tagging; a tag without a green full run fails closed.

## Alternatives considered

- **Full suite on every PR:** strongest merge gate, but keeps agent feedback at
  ~10 minutes and does not address duplicate release validation.
- **Smoke-only PRs plus a periodic full run:** cheaper, but weaker than running
  the full suite on every merge to `main`; a weekly run can leave `main` broken
  for days.
- **More Playwright shards:** halves wall-clock but roughly doubles E2E compute,
  and the current four workers already saturate the four-vCPU runner.
- **Keep tag validation:** safe but duplicates the exact same SHA validation
  and false-blocks releases when a flaky test passes on `main` but fails on the
  tag.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add selector unit tests, a fake-server reset fixture, and an E2E budget.
- [ ] Link this ADR from the change summary.
