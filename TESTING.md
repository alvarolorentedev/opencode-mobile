# Testing Strategy

This repo uses CI-enforced flow validation instead of broad unit test coverage.

## Principles

- Test complete user flows, not isolated helpers.
- Always run integration flows against a fake OpenCode server.
- Keep the merge gate deterministic and fast enough for trunk-based development.
- Use the iOS release build to catch native and Expo regressions.

## CI Gates

The single `.github/workflows/build.yml` workflow owns validation and release, and runs on pushes to `main` and `v*` tags.

It enforces a single `validate` gate:

1. `validate`
   - `npm run lint`
    - `npm run typecheck`
    - `npm run test:workspace-patch`
    - `npm run test:fake-server:self`
   - starts the fake OpenCode server
   - starts the Expo web app in CI mode
   - runs Playwright flow tests against the fake server

iOS native validation happens in the `ios-release` job, so there is no separate prebuild job. Release builds (`v*` tags) run in the same workflow only after `validate` passes. Actions artifacts expire after 3 days; the permanent copy is the GitHub Release asset or store upload. `.github/workflows/cleanup.yml` runs weekly to purge artifacts older than 3 days and keep only the newest Gradle/npm cache.

## Why This Repo Uses Flow Tests

The highest-risk behavior in this app is orchestration across:

- connection bootstrapping and workspace hydration
- session lifecycle and prompt submission
- permission blocking flows
- provider configuration and model availability
- event-stream updates and polling fallback

Those behaviors live primarily in `providers/opencode-provider.tsx`, `components/chat/chat-view.tsx`, `app/(tabs)/workspace.tsx`, `app/(tabs)/settings.tsx`, and `lib/opencode/client.ts`.

## Fake OpenCode Server

The deterministic server lives in `tests/fake-opencode/server.mjs`.

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

The Playwright suite resets the server between tests through `POST /__control/reset`.

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

## Local Commands

```bash
npm run test:fake-server:self
npm run test:workspace-patch
npm run test:e2e:web
npm run build:development:android
```

If you need to debug the fake backend directly:

```bash
npm run test:fake-server
```

The app is built in `EXPO_PUBLIC_E2E_MODE=1` for CI flow tests so notification and voice bootstrap side effects do not interfere with deterministic automation.

Android native validation happens only in the tagged release build in `.github/workflows/build.yml`; the local `npm run build:development:android` command remains available for manual use.
