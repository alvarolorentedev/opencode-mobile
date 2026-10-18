# Testing Strategy

This repo uses CI-enforced flow validation instead of broad unit test coverage.

The authoritative, detailed reference is
[`docs/testing-and-validation.md`](docs/testing-and-validation.md). This file is
the short overview of the strategy and the merge gate.

## Principles

- Test complete user flows, not isolated helpers.
- Always run integration flows against a fake OpenCode server.
- Keep the merge gate deterministic and fast enough for trunk-based development.
- Use the iOS release build to catch native and Expo regressions.

## CI Gates

Three workflows run the same `validate` gate:

- `.github/workflows/build.yml` — pushes to `main` and `v*` tags
- `.github/workflows/pr-validate.yml` — pull requests targeting `main`
- `.github/workflows/ios-release.yml` — manual iOS release dispatch

`validate` runs:

1. `npm run test:ci:static` — lint, app TypeScript type-checking, and the Vitest
   suites. The exact set is the script in `package.json`; do not duplicate the
   list in prose.
2. `npm run test:fake-server:self`
3. `npm run test:e2e:web` — builds the web bundle, boots the fake server, and
   runs the Playwright flows.

The three workflows currently repeat the `validate` steps inline. A reusable
workflow has not been extracted yet; until it is, keep the three step lists in
sync when the gate changes.

`ios-release` also builds and signs the iOS archive after `validate`; the Android
release jobs (`android-release`, `foss-release`) run after `validate` on `v*` tags
or a manual dispatch with `build_android: true`. Actions artifacts expire after a
few days; the permanent copy is the GitHub Release asset or store upload.

## Why This Repo Uses Flow Tests

The highest-risk behavior in this app is orchestration across:

- connection bootstrapping and workspace hydration
- session lifecycle and prompt submission
- permission blocking flows
- provider configuration and model availability
- event-stream updates and polling fallback

Those behaviors live primarily in `providers/opencode-provider.tsx`,
`components/chat/chat-view.tsx`, `app/(tabs)/workspace.tsx`,
`app/(tabs)/settings.tsx`, and `lib/opencode/client.ts`.

## Fake OpenCode Server

The primary deterministic backend is native v2 in `tests/fake-opencode/server.mjs`
(`npm run test:fake-server`). The v1 compatibility boundary is `server-v1.mjs`
(`npm run test:fake-server:v1`). Playwright uses v2 by default, with explicit v1
coverage for shared flows and compatibility-only features.

It simulates:

- workspace discovery
- session creation, listing, status, title updates, deletion, fork, share, revert, messages, diffs, and todos
- command discovery and execution
- file list/path/text/symbol search, read/status, conflict-checked patch apply, and VCS metadata/diffs
- global health plus MCP lifecycle/config/OAuth, LSP, and formatter diagnostics
- archived sessions and experimental worktree lifecycle
- PTY lifecycle plus ticket-authenticated WebSocket input/output
- session children, initialization, and shell execution
- provider catalog and auth metadata
- full permission events and session-scoped responses
- global SSE event envelopes
- polling fallback when SSE is unavailable

Supported scenarios:

- `happy-path`
- `permission`
- `question`
- `stream-disconnect`

The Playwright suite resets the server between tests through
`POST /__control/reset`.

## Flow Coverage

The current CI suite validates:

- app boot -> connect -> auto-create/open session
- prompt submission -> assistant response -> diff visibility
- permission request -> user approval -> run continues
- assistant question -> user answer -> run continues
- session rename and guarded deletion
- command execution and workspace file search
- provider setup from Settings against fake metadata
- polling fallback when the SSE stream is unavailable
- connection recovery through a path-prefixed API URL
- workspace text patch save and session archive/restore
- experimental worktree creation and MCP server addition
- terminal creation and WebSocket line input/output
- favorites reopening sessions across workspaces
- saved connections switching between two servers that expose the same project
  paths, with separate session caches and restored per-connection model selection

## Local Commands

```bash
npm run test:ci:static
npm run test:fake-server:self
npm run test:e2e:web
npm run build:development:android
```

If you need to debug the fake backend directly:

```bash
npm run test:fake-server
```

The app is built in `EXPO_PUBLIC_E2E_MODE=1` for CI flow tests so notification and
voice bootstrap side effects do not interfere with deterministic automation.

Android native validation happens on every CI run in the `android-release` job in
`.github/workflows/build.yml`; the local `npm run build:development:android`
command remains available for manual use.

## Test Layout

- `tests/vitest/` — Vitest suites, run by `npm run test:vitest` (part of
  `npm run test:ci:static`). They are not type-checked by `tsc`; many drive the
  dynamic `loadTs`/`hookRuntime` harness in `tests/helpers/runtime.mjs`.
- `tests/e2e/` — Playwright flow specs.
- `tests/fake-opencode/` — the deterministic v1/v2 fake servers and their self-test.
- `tests/foss-prepare.test.mjs` — FOSS build-tooling check, run by `npm run test:foss`.

See [known gaps](docs/known-gaps.md) for deferred test-infrastructure work.

## v2 primary acceptance

Run `npm run test:ci:static`, `npm run test:fake-server:self`, and
`npm run test:e2e:web`; all three gates must pass before push. The SDK import
boundary is checked statically. Regressions cover native cursors/events,
accumulated usage/todos, connection switching and persisted continuity, guarded
file saves, and MCP integration OAuth.

Run `npm run build:development:android`, then validate editing, code/automatic
OAuth, reconnects and terminals against real v2 and v1 servers on devices. The
pre-save read is not atomic with the write. Any changed fake-server or E2E
contract requires explicit human validation under AGENTS.md before completion.
