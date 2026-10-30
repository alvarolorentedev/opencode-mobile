# Fake OpenCode Server

The deterministic backend lives under `tests/fake-opencode/`. It is the
behavioral contract for the app, not a mock of individual functions.

Back to the [validation index](../testing-and-validation.md) · [engineering index](../README.md).

- `tests/fake-opencode/server-v1.mjs` emulates the OpenCode 1.x contract.
- `tests/fake-opencode/server.mjs` emulates the OpenCode 2.x `/api` contract (discovery, capabilities, sessions, messages, prompt, diff, permissions, forms, MCP, PTY, VCS, and the flat V2 event stream), using canonical native fixtures and shared version-neutral filesystem/terminal infrastructure.

Both servers raise `keepAliveTimeout` above a single flow's duration. Playwright's
`APIRequestContext` pools keep-alive sockets per test, and Node's 5s default
could close an idle connection between a long UI step and the next control
request, which surfaced as an intermittent `apiRequestContext ... socket hang
up` failure. The test runner owns the process lifetime, so the longer timeout
does not leave stray connections after the run.

Each Playwright worker owns one V1/V2 pair. The `resetBackend` auto fixture
posts `/__control/reset` before every test, so sessions, scenario state, network
injection, and pending blockers cannot leak between flows. Tests may still call
`resetScenario` to select a non-default scenario after that reset. The reset is
a test-harness contract; it does not change production endpoints.

The V2 self-test submits prompts through the pinned `@opencode/client` SDK,
checks that the HTTP 200 admission identifies the stored user message, and
verifies that session events carry that session's directory. Non-session events
use the server's main directory. Scoped session lists filter by `directory`;
unscoped lists include every project for the Chat Library's recent group.

Its intended job is to simulate the server behaviors this client depends on, including:

- project discovery
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
- SSE event delivery
- file list/path/text/symbol search, conflict/patch application, and VCS diff/status
- archived sessions and experimental worktrees
- MCP lifecycle/config/OAuth endpoints
- PTY REST endpoints and ticket-authenticated WebSocket input/output
- session children, initialization, and shell execution endpoints

Scenarios in the test infrastructure that correspond to supported app behavior:

- `happy-path`
- `permission`
- `question`
- `stream-disconnect`
- `retry` (V2)

### Happy Path

Simulates a normal session run that completes and returns:

- assistant text
- a patch detail
- one structured diff entry
- two completed todos
- idle session status at the end

Diff retrieval follows the real message-scoped contract: v1 requests without `messageID` return an empty list; v2 selects a turn with native `from`, while a completed user message exposes its own diff. VCS `mode=git` and `mode=branch` return distinct fixtures so the Files Changed diff scopes can be exercised; V2 exposes the same through `/api/vcs/diff` with `working`/`branch` and, like form and permission lists, rejects VCS requests that omit `location[directory]`, so an unscoped client call fails the Files Changed flows instead of silently reporting no changes.

### Permission Scenario

Instead of completing immediately, the server emits a pending permission request and waits for client approval before finishing.

### Question Scenario

The server emits a pending assistant question and waits for an ordered answer payload before finishing.

### Stream Disconnect Scenario

The SSE endpoint intentionally fails, forcing the app to complete the workflow through polling fallback.

### Provider Retry Scenario (V2)

A prompt fails mid-turn (`session.execution.failed`) and the server schedules an automatic retry (`session.retry.scheduled`). The retry status is event-only: the running set excludes it, so a session-list refresh must preserve it. The recovered output is then written to state with no SSE event, so only the busy safety poll can surface it. This reproduces the Android freeze from issue #71.

## Adding a scenario

See the [fake-server recipe](../task-recipes.md#fake-server-scenario-and-e2e-flow).
Update state, fixtures, the server handler, the self-test, and the E2E helper in
one change. Keep V1 and V2 behavior aligned where the feature is in the
supported intersection.
