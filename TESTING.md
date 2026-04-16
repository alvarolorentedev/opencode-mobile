# Testing Strategy

This repo uses CI-enforced flow validation instead of broad unit test coverage.

## Principles

- Test complete user flows, not isolated helpers.
- Always run integration flows against a fake OpenCode server.
- Keep the merge gate deterministic and fast enough for trunk-based development.
- Use Android build validation to catch native and Expo regressions.

## CI Gates

The main validation workflow lives in `.github/workflows/trunk-validation.yml` and runs on every push.

It enforces three gates:

1. `static`
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test:fake-server:self`
2. `flow-regression`
   - starts the fake OpenCode server
   - starts the Expo web app in CI mode
   - runs Playwright flow tests against the fake server
3. `android-build`
   - builds the Android development APK through the existing Gradle pipeline

## Why This Repo Uses Flow Tests

The highest-risk behavior in this app is orchestration across:

- connection bootstrapping and workspace hydration
- session lifecycle and prompt submission
- permission and question blocking flows
- provider configuration and model availability
- event-stream updates and polling fallback

Those behaviors live primarily in `providers/opencode-provider.tsx`, `components/chat/chat-view.tsx`, `app/(tabs)/workspace.tsx`, `app/(tabs)/settings.tsx`, and `lib/opencode/client.ts`.

## Fake OpenCode Server

The deterministic server lives in `tests/fake-opencode/server.mjs`.

It simulates:

- workspace discovery
- session creation, listing, status, messages, diffs, and todos
- provider catalog and auth metadata
- permission requests
- question requests
- SSE event streaming
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
- question request -> user answer -> run continues
- provider setup from Settings against fake metadata
- polling fallback when the SSE stream is unavailable

## Local Commands

```bash
npm run test:fake-server:self
npm run test:e2e:web
npm run build:development:android
```

If you need to debug the fake backend directly:

```bash
npm run test:fake-server
```

The app is built in `EXPO_PUBLIC_E2E_MODE=1` for CI flow tests so notification and voice bootstrap side effects do not interfere with deterministic automation.
