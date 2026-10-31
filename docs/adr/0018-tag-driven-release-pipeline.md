# ADR 0018: Tag-driven release pipeline with static artifact verification

- Status: Accepted
- Date: 2026-10-31
- Deciders: maintainers
- Supersedes: ADR 0011
- Related: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), [`.github/workflows/release.yml`](../../.github/workflows/release.yml), [`scripts/ci/verify-android-release.mjs`](../../scripts/ci/verify-android-release.mjs), [Development](../engineering/development.md), [Validation strategy](../engineering/validation/strategy.md), [ADR 0019](0019-arm64-only-android-releases.md)

## Context

The repository had five workflows, a `workflow_run` dependency on a green
`Build` run, exact-SHA GitHub API lookups, a custom changed-path classifier, and
a separate manual iOS release. A tag push could not be the release command
without racing the main validation, and iOS was not part of the tag release.
Android and FOSS jobs duplicated setup and signing work.

A release also compiled and published artifacts without proving that the
installed production application could start. The WorkManager/R8 startup crash
in 1.0.110 showed that compilation and web E2E alone are insufficient. At the
same time, the project does not need a self-hosted emulator or paid device farm:
static artifact verification plus Google Play internal testing and TestFlight provide
the required release checks at low cost.

## Decision

Use exactly two workflow files:

- `ci.yml` runs on pushes to `main` and pull requests. It runs static checks,
  Vitest and architecture checks, fake-server validation, Storybook, FOSS
  preparation, the E2E budget and critical Playwright smoke flows. It never
  accesses release signing secrets.
- `release.yml` runs automatically on a `v*` tag. It verifies the tag, version
  and build numbers; requires the tagged commit to belong to `main`; runs the
  full release validation once; builds Android Play, FOSS Android and signed iOS
  in parallel; statically verifies every artifact; uploads validated Android
  builds to Google Play internal testing and iOS builds to TestFlight; and publishes the
  GitHub Release only after all mandatory jobs succeed.

The release does not require a manual dispatch, approval or release command for
normal internal releases. `workflow_dispatch` exists only for recovery and
rerunning an existing tag. Nothing is automatically promoted to a production
store track.

Android and FOSS builds use one ARM64-only release configuration. The release
workflow never uses emulator ABIs, a self-hosted runner or a paid device-testing
service. Static verification covers signing, package identity, version, ABI,
native libraries, R8/ProGuard safety, the WorkManager constructor, FOSS
exclusions and 16 KB page-size alignment. Static verification cannot prove
successful device startup; Google Play internal testing and TestFlight are the
real-device validation environments.

Release tags are protected against unauthorized creation, update and deletion.
Release secrets are available only to release jobs; only the GitHub publication
job has `contents: write`.

## Consequences

- Main and pull-request feedback is faster and predictable: static checks plus
  smoke, with no path classifier or gate job.
- Full browser E2E and native builds run once per release instead of on every
  main push.
- A tag push is sufficient to validate, build, distribute internally and publish
  a release. There is no exact-SHA polling or cross-workflow race.
- A failed validation, build or static artifact check blocks all distribution and
  GitHub publication.
- Google Play internal testing and TestFlight replace the proposed emulator gate for
  real-device startup validation. A device-only startup failure is found after
  internal distribution, not before it; the fix is a new version and tag.
- Release tags must never be moved. A failed release is fixed forward with a new
  version.
- The workflow files and their supporting scripts are the release authority; local
  full-gate and native-build commands are no longer mandatory before every push.

## Alternatives considered

- **Keep `workflow_run` and exact-SHA validation:** rejected because it couples
  release to another workflow, races tag pushes and adds GitHub API coordination.
- **Run full E2E on every main push:** rejected because the tag release already
  runs the full suite and main feedback must stay fast.
- **Keep the manual iOS workflow:** rejected because it duplicates validation and
  signing and makes a tag release incomplete.
- **Add a hosted x86_64 emulator cold-launch job:** rejected because it requires
  emulator infrastructure and an extra production ABI. Static verification plus
  store internal testing is the chosen tradeoff.
- **Use a paid device-testing service:** rejected as unnecessary cost and
  operational complexity for this project.

## Follow-up

- [x] Replace the five workflows with `ci.yml` and `release.yml`.
- [x] Remove the changed-path classifier and exact-SHA validation lookup.
- [x] Add static Android release verification and ARM64-only artifacts.
- [x] Add Play internal and TestFlight distribution to the tag release.
- [x] Update AGENTS, development, validation and release documentation.
- [ ] Confirm the first tag release and record actual runtimes.
