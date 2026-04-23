# Testing And Validation

## Current Strategy

This repository validates behavior primarily through end-to-end flow tests and static checks, not broad unit-test coverage.

That choice matches the app's risk profile:

- most complexity sits in orchestration, not isolated algorithms
- the highest-risk failures involve server interaction, session state, and realtime updates
- platform side effects need integration-level confidence more than helper-level confidence

## CI Gates

The documented main validation workflow lives in `.github/workflows/trunk-validation.yml` and enforces:

1. static validation
2. flow regression testing
3. Android build validation

From `TESTING.md`, those gates include:

- `npm run lint`
- `npm run typecheck`
- `npm run test:fake-server:self`
- Playwright E2E flow tests against the fake OpenCode server
- Android development build validation

## Fake OpenCode Server

The deterministic backend lives under `tests/fake-opencode/`.

Its job is to simulate the server behaviors this client depends on, including:

- workspace discovery
- config fetch/update
- provider listing and auth metadata
- agent listing
- session creation/listing/status
- message retrieval
- diff retrieval
- todo retrieval
- prompt submission
- session abort
- session title summarization
- permission requests
- question requests
- SSE event delivery

## Fake Server Scenarios

Current scenarios represented in the test infrastructure:

- `happy-path`
- `permission`
- `question`
- `stream-disconnect`

### Happy Path

Simulates a normal session run that completes and returns:

- assistant text
- a patch detail
- one structured diff entry
- two completed todos
- idle session status at the end

### Permission Scenario

Instead of completing immediately, the server emits a pending permission request and waits for client approval before finishing.

### Question Scenario

Instead of completing immediately, the server emits a pending question and waits for the client response before finishing.

### Stream Disconnect Scenario

The SSE endpoint intentionally fails, forcing the app to complete the workflow through polling fallback.

## What The E2E Suite Currently Proves

From `tests/e2e/flows.spec.mjs`, the suite currently exercises these flows:

### Boot And Ready Chat

- load app
- if needed, switch to Workspace and select the fake project
- return to Chat
- confirm empty-state prompt and input are visible

### Main Happy Path Chat Flow

- send a prompt
- wait for finished assistant text
- verify the resulting chat appears in the Workspace tab
- verify archive controls appear

### Permission Blocking Flow

- send a prompt that triggers a permission request
- approve it
- verify run completion

### Question Blocking Flow

- send a prompt that triggers a question request
- answer it
- verify run completion

### Provider Setup Flow

- open Settings
- add OpenRouter from the fake provider list
- enter an API key
- save configuration
- verify provider appears as configured

### SSE Failure / Polling Fallback Flow

- run a prompt when the fake event stream is unavailable
- switch to Workspace
- verify the session still completes and becomes idle

## Coverage Strengths

The current strategy gives good confidence in these areas:

- provider-driven app bootstrapping
- workspace selection and session continuity
- session send/refresh lifecycle
- blocking interactions from the server
- provider configuration flow
- resilience to SSE failure

## Coverage Gaps

The following important behaviors are present in code but are not obviously covered by the current documented E2E suite:

- conversation mode state machine
- speech recognition failures and permission edge cases
- TTS playback behavior
- notification initialization and background monitoring
- archive/unarchive behavior beyond presence of controls
- attachment upload behavior
- auto-approve config toggling
- model enablement filtering and preference reconciliation
- session summarization fallback behavior
- keep-awake and brightness side effects

These are useful candidates for future validation if the product depends on them heavily.

## Why The Fake Server Matters For Parity

The fake server documents which OpenCode interactions the client expects to exist and how the client reacts to them.

For reimplementation work, it acts as a practical parity contract for:

- endpoint shape expectations
- event types the UI listens for
- blocking workflow semantics
- session completion semantics

## Practical Validation Commands

Useful local commands documented in the repo:

```bash
npm run lint
npm run typecheck
npm run test:fake-server:self
npm run test:e2e:web
npm run build:development:android
```

To debug the fake backend directly:

```bash
npm run test:fake-server
```

## Reimplementation Validation Recommendation

If the app is ever rewritten, parity should be judged at minimum against these behaviors:

1. hydration -> connect -> workspace discovery -> session bootstrap
2. prompt send -> transcript refresh -> diff/todo refresh -> idle completion
3. permission blocking and resolution
4. question blocking and resolution
5. capability discovery and provider configuration
6. SSE failure fallback through polling

After that baseline, the next most valuable parity suite would add:

1. attachment handling
2. conversation mode loop
3. notification completion behavior
4. auto-approve and settings persistence
