# ADR 0009: Agent-first documentation routing and drift checks

- Status: Accepted
- Date: 2026-10-29
- Deciders: maintainers
- Supersedes: —
- Related: [Documentation router](../README.md), [AGENTS.md](../../AGENTS.md), [task recipes](../engineering/task-recipes.md), [docs checks](../../tests/vitest/docs.test.ts)

## Context

The section tree and task router from ADR 0008 made the documentation
discoverable, but the always-on instructions still told every agent to read five
reference docs before starting. That is roughly 83k tokens, or about 40% of a
200k context window, before the task is identified. The same instruction was
repeated in the router's onboarding path.

The largest reference docs also had no section maps. A settings change could
require reading the full component inventory, and a validation change could
require reading the full testing history. The docs test checked Markdown links,
anchors, ADRs, and Storybook wiring, but not inline repository paths or
`npm run` scripts, so stale commands and paths survived.

Historical validation narratives and a design QA log accumulated dates, local
artifact paths, and superseded test counts. They described work already encoded
in E2E specs and feature docs, and they made agents read irrelevant history.

## Decision

Optimize the documentation for task-scoped retrieval and enforce the parts that
can drift.

- `AGENTS.md` routes by task: a compact table maps "task touches" to the owning
  doc section and the validation command. It no longer preloads the docs tree.
- The router keeps a one-time "First time in this repo" path, explicitly marked
  as onboarding rather than a per-task requirement.
- `providers/AGENTS.md` holds provider-specific ownership and pitfalls; agents
  load it lazily when working in `providers/`.
- `docs/engineering/task-recipes.md` holds four checklists for the highest-churn
  workflows: translations, settings, fake-server/E2E, and provider state.
- Mixed reference docs are split behind stable index pages:
  `docs/design/component-inventory.md` indexes `docs/design/components/*.md`,
  and `docs/engineering/testing-and-validation.md` indexes
  `docs/engineering/validation/*.md`.
- The docs test validates inline repository paths and `npm run` scripts in
  addition to links, anchors, ADRs, and Storybook wiring.
- Historical validation logs, the design QA log, duplicated narratives, and
  local artifact paths are removed. The current contract is the E2E spec plus
  the owning feature doc; deferred coverage lives in `known-gaps.md`.
- Accepted ADRs are immutable. A later decision supersedes them; it never
  rewrites them.

## Consequences

Agents can start with the router and one task row, then read one section or
recipe. The baseline context drops from roughly 86k tokens to roughly 5k before
the task doc. Mixed reference docs can be read by area without loading the rest.

The cost is maintenance: the task table, recipes, scoped provider file, and
section indexes must stay current. The docs test catches broken links, anchors,
paths, and scripts, but not stale prose; reviewers still own semantic accuracy.
Splitting reference docs adds files, but the stable index pages keep existing
links working.

## Alternatives considered

- **Keep the five-doc preload:** rejected because it spends most of the context
  budget before the task is known.
- **Split every large doc:** rejected as unnecessary churn; section maps and the
  two mixed-doc splits cover the measured problem.
- **Add a docs site or search service:** rejected; it adds a dependency and does
  not improve in-repo agent retrieval.
- **Vendor Expo/React Native agent skills:** rejected; the official skills are
  generic and should be installed per developer, while repo docs remain
  authoritative for architecture, fake-server, and design contracts.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add docs-test coverage for inline paths and scripts.
- [x] Link this ADR from the router and change summary.
