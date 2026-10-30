# ADR 0011: Release from green main builds, not tag pushes

- Status: Accepted
- Date: 2026-10-30
- Deciders: maintainers
- Supersedes: [ADR 0010](0010-risk-based-validation-and-selective-pr-e2e.md)
- Related: [`.github/workflows/build.yml`](../../.github/workflows/build.yml), [`.github/workflows/release.yml`](../../.github/workflows/release.yml), [`scripts/ci/assert-validated.mjs`](../../scripts/ci/assert-validated.mjs), [Development](../engineering/development.md), [Validation strategy](../engineering/validation/strategy.md)

## Context

ADR 0010 stopped rerunning the full suite on a release tag by making the tag
workflow assert that a successful `Build` run already existed on `main` for the
same SHA. That check runs immediately when the tag workflow starts. Pushing
`main` and its tag together therefore fails the release: the `main` run is still
queued or running when the tag queries for it.

The same change moved GitHub Release creation into a `release-gate` job so the
parallel Android and FOSS uploads would not race to create it. That introduced
a second failure mode: `release-gate` depends on the tag-only `validate` job,
which is skipped; GitHub propagates skipped ancestors through `needs` even when
the intermediate job runs with `always()`. The build jobs were skipped, the run
reported success, and the Release was left published with no assets. Rerunning
failed jobs does not recover skipped dependents.

The release trigger must not depend on a different workflow run finishing, and a
release must never be published before its assets exist.

## Decision

Validation and release are separate workflows with an event-based dependency:

- `build.yml` validates pushes to `main` only. Tag pushes do not trigger it, so
  pushing `main` and its tag together is safe.
- `release.yml` triggers on `workflow_run` when `Build` completes on `main`, and
  on manual dispatch. It reads the validated `head_sha` from that event.
- A release happens only when a `v*` tag points at the validated commit. The tag
  must match the `version` in `app.config.ts`.
- The workflow verifies the exact SHA has a successful full validation, creates
  a **draft** GitHub Release once, builds Android and FOSS in parallel, attaches
  both APKs, and publishes the draft only after both uploads succeed.
- Manual dispatch takes `tag` and `publish`. It supports repairing a broken
  release and building sideload APKs without touching a Release.
- A failed or partial build leaves an unpublished draft, never a published
  release with missing assets.

The risk-based PR selection and full `main` validation from ADR 0010 remain in
force; only its release-trigger mechanism is replaced.

## Consequences

Releases no longer race validation. A maintainer can push the version bump and
its tag in either order or together. The Release workflow runs from the default
branch, so workflow fixes apply without moving a tag.

`release.yml` rebuilds on every green `main` run only long enough to resolve the
tag and no-op; there is no build cost when the version did not change. Repairing
a release means dispatching the workflow with its tag. Manual tagging remains
required: the workflow does not bump versions or create tags.

The draft-then-publish sequence means a successful workflow is the only signal
that a release is complete. The workflow is idempotent (`--clobber` uploads and
an `isDraft` check) so it can be rerun safely.

## Alternatives considered

- **Keep the tag trigger and poll for the main validation:** removes the
  immediate race but keeps cross-run coupling, adds a wait, and does not fix the
  skipped-dependent or empty-release failure modes.
- **Validate on the tag again:** no race, but duplicates the full suite and was
  already rejected in ADR 0010.
- **Keep `release-gate` and add `always()` to the builds:** fixes the skip, but
  still races the tag against the main validation and still creates a published
  release before assets exist.
- **Auto-bump and release on every green `main`:** removes manual tags, but
  releases every merge and loses explicit control over the version and curated
  changelog.

## Follow-up

- [x] Move release builds into `release.yml` and reduce `build.yml` to
      validation.
- [x] Create the release as a draft and publish only after both APKs attach.
- [x] Update the release documentation and validation strategy.
- [ ] Link this ADR from the change summary.
