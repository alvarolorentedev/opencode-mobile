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

`validate.yml` is the single reusable gate (`workflow_call`). Three callers use
it:

- `build.yml` — pushes to `main` and `v*` tags
- `pr-validate.yml` — pull requests targeting `main`
- `ios-release.yml` — manual iOS release dispatch

`validate` runs:

1. `npm run test:ci:static` — lint, app and test type-checking, and Vitest.
   `package.json` is the source of truth for the exact suite list.
2. `npm run test:fake-server:self`
3. `npm run build:storybook`
4. `npm run test:e2e:web` — one web export, four Playwright workers, each with
   its own fake V1/V2 server pair.

The three callers use the reusable workflow; the gate is defined once in
`validate.yml`. Change the gate there, not in the caller workflows.

`ios-release` also builds and signs the iOS archive after `validate`; the Android
release jobs (`android-release`, `foss-release`) run after `validate` on `v*`
tags or a manual dispatch with `build_android: true`. Release artifacts expire;
the permanent copy is the GitHub Release asset or store upload.

## Why this repo uses flow tests

The highest-risk behavior is orchestration across:

- connection bootstrapping and workspace hydration
- session lifecycle and prompt submission
- permission blocking flows
- provider configuration and model availability
- event-stream updates and polling fallback

Those behaviors live primarily in `providers/use-opencode-provider-composition.ts`,
`components/chat/chat-view.tsx`, `app/(tabs)/projects.tsx`,
`app/(tabs)/settings.tsx`, and `lib/opencode/client.ts`.

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
