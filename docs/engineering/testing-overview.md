# Testing Strategy

This repo validates behavior with CI-enforced flow tests and static checks, not
broad unit-test coverage.

The detailed reference is [validation/strategy.md](./validation/strategy.md),
with the fake server, E2E flows, and feature map in the
[validation index](./testing-and-validation.md). This page is the short
merge-gate overview.

## Principles

- Test complete user flows, not isolated helpers.
- Run integration flows against a deterministic fake OpenCode server.
- Keep the merge gate deterministic and fast enough for trunk-based development.
- Use the iOS release build to catch native and Expo regressions.

## Merge gate

Two workflows own validation:

- `ci.yml` — pushes to `main`, pull requests, and reusable `workflow_call` from
  the release workflow.
- `release.yml` — `v*` tag pushes, plus recovery-only manual dispatch.

`ci.yml` runs in parallel:

1. `static` — `npm run test:ci:static` (lint, app/test type-checking, Vitest and
   architecture checks), fake-server self-test, FOSS preparation, E2E budget,
   Storybook build and Android release-check self-test.
2. `e2e` — critical `@smoke` Playwright flows. The release workflow calls the
   same job with `mode: full` to run the complete suite once.

There is no changed-path classifier and no gate job. Required checks are
`CI / static` and `CI / e2e`.

`release.yml` runs full validation once, then builds Android Play, FOSS Android
and signed iOS in parallel. It statically verifies signing, package identity,
version, ARM64-only ABI, native libraries, R8/ProGuard safety, the WorkManager
constructor, FOSS exclusions and 16 KB page-size alignment before uploading to
Google Play internal testing, TestFlight and the GitHub Release.

`android-cache.yml` runs twice a week to rebuild the release Gradle tasks on
`main` and keep the build cache that `release.yml` restores. It is not a merge
gate and publishes nothing.

Static artifact verification cannot guarantee successful device startup. Play
internal testing and TestFlight are the real-device validation environments.
There is no emulator or self-hosted device job. Release artifacts expire; the
permanent copy is the GitHub Release asset or store upload.

## Why this repo uses flow tests

The highest-risk behavior is orchestration across:

- connection bootstrapping and workspace hydration
- session lifecycle and prompt submission
- permission blocking flows
- provider configuration and model availability
- event-stream updates and polling fallback

Those behaviors live primarily in `runtime/composition/use-opencode-provider-composition.ts`,
`features/chat/ui/chat-view.tsx`, `features/projects/ui/projects-screen.tsx`,
`features/settings/ui/settings-screen.tsx`, and `shared/protocol/opencode/client.ts`.

## Local commands

```bash
npm run test:ci:static
npm run test:fake-server:self
npm run test:e2e:web
npm run validate:fast
npm run build:development:android
```

## Test layout

- `tests/vitest/` — Vitest suites, run by `npm run test:vitest` (part of
  `npm run test:ci:static`). `npm run typecheck:tests` type-checks them via
  `tsconfig.tests.json`.
- `tests/e2e/` — Playwright flow specs, split by domain over
  `tests/e2e/helpers/flows.mjs`.
- `tests/fake-opencode/` — the deterministic V1/V2 fake servers and their
  self-test.
- `tests/native/` — native-specific checks and fixtures.
- `tests/foss-prepare.test.mjs` — FOSS build-tooling check, run by
  `npm run test:foss`.

## What it does not prove

Web checks do not establish native frame rate, launch latency, battery use,
memory, physical-device keyboard behavior, camera or microphone permission
flows, screen-reader acceptance, real store purchases, or full-screen terminal
compatibility. See [validation/strategy.md](./validation/strategy.md),
[voice validation](./voice-validation.md), and [known gaps](./known-gaps.md).
Changes under `tests/e2e/` or `tests/fake-opencode/` require explicit human
validation under [AGENTS.md](../../AGENTS.md).
