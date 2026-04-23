# AGENTS.md

Follow the current implementation docs in `docs/`. Do not invent a new architecture.

Read first:

1. `docs/architecture.md`
2. `docs/state-and-data.md`
3. `docs/component-inventory.md`
4. `docs/testing-and-validation.md`

## Architecture Rule

This app is provider-centric.

- `providers/opencode-provider.tsx` owns domain state and orchestration.
- `app/` owns routing and thin screen wiring.
- `components/` owns presentation and local UI state.
- `providers/services/` owns provider-facing API aggregation.
- `lib/` owns protocol, formatting, storage keys, notifications, and voice helpers.
- `tests/fake-opencode/` and `tests/e2e/` define the behavioral contract.

Do not move domain behavior into screens or presentational components.

## Placement Rules

### `app/`

Put:

- route entrypoints
- tab/layout wiring
- thin screen controllers
- calls into `useOpencode()`

Do not put:

- fetch logic
- session orchestration
- capability reconciliation
- protocol shaping

### `components/`

Put:

- rendering
- local UI state
- chat/settings UI composition
- surface-specific helpers

Do not put:

- API calls
- persistence
- shared domain state
- cross-session caches

### `providers/`

Put:

- connection flow
- workspace/session state
- refresh logic
- permission/question handling
- capability reconciliation
- conversation mode state machine
- SSE and polling fallback
- persistence hydration and write-back

Shared behavior across tabs belongs here.

### `providers/services/`

Put:

- session fetch helpers
- capability/config/provider discovery helpers

Services aggregate requests. They do not own app state.

### `lib/opencode/`

Put:

- client construction
- endpoint wrappers
- protocol types
- message formatting
- transcript transformation

Raw server-shape handling belongs here, not in UI code.

### `lib/`

Put:

- notifications
- speech input/output
- storage keys
- platform integration helpers

Platform side effects should start here or from the root shell, not from arbitrary components.

### `tests/fake-opencode/`

Put:

- deterministic server scenarios
- endpoint fixtures
- SSE behavior
- permission/question blocking logic

If the client contract changes, update the fake server.

### `tests/e2e/`

Put:

- boot flow coverage
- prompt lifecycle coverage
- blocking interaction flows
- provider setup flows
- SSE fallback coverage

Prefer flow coverage over low-value unit tests for orchestration changes.

## Practices

- Keep screens thin.
- Keep presentational components dumb except for local UI state.
- Put code in the narrowest correct layer.
- Extend existing helpers, selectors, and services before adding abstractions.
- Keep protocol normalization close to `lib/opencode/`.
- Keep persistence logic close to `providers/use-opencode-persistence.ts`.
- Preserve continuity across tabs.
- Respect the dual realtime model: SSE plus polling fallback.
- Prefer deterministic state transitions over clever indirection.

## Avoid

- fetch logic in components
- formatting or protocol parsing in screens
- new shared state stores outside the provider
- duplicated provider-derived state in local UI state
- protocol changes hidden in UI code
- unrelated refactors

## Change Mapping

### Chat

- visuals, composer presentation, pagination, local interaction state: `components/chat/`
- transcript shaping and activity derivation: `lib/opencode/` or provider selectors
- prompt lifecycle, abort, pending interactions, refresh behavior: `providers/`

### Workspace

- screen wiring and list presentation: `app/(tabs)/workspace.tsx`
- project/session continuity rules: `providers/`
- project/session fetch logic: `providers/services/session-service.ts`

### Settings

- section and dialog UI: `components/settings/`
- persisted preferences and reconciliation: `providers/`
- provider auth and capability requests: `providers/services/capabilities-service.ts` and `lib/opencode/client.ts`
- platform deep links and native integration: `lib/`

### Protocol

Update together when needed:

- `lib/opencode/client.ts`
- `lib/opencode/types.ts`
- `lib/opencode/format.ts`
- matching fake-server handlers in `tests/fake-opencode/`

### Conversation mode, voice, notifications

- orchestration and state machine: `providers/`
- native wrappers: `lib/voice/` and `lib/notifications.ts`
- UI affordances: `components/chat/`

## Development Loop

For each task:

1. Read the relevant docs and implementation.
2. Identify the correct layer.
3. Make the smallest change that preserves documented behavior.
4. Add or update tests when the behavior contract changes.
5. Update docs when architecture, behavior, or contracts change.
6. Run validation proportional to risk.

## Validation

Baseline:

```bash
npm run lint
npm run typecheck
```

Run when relevant:

- fake backend or protocol changes:
  - `npm run test:fake-server:self`
- provider, session, blocking flow, SSE, polling, or user-flow changes:
  - `npm run test:e2e:web`
- native or Android-risk changes:
  - `npm run build:development:android`

## Tests

This repo validates behavior mainly with static checks and end-to-end flows.

Add or update tests when changing:

- hydration or connect flow
- workspace discovery or session bootstrap
- prompt submission lifecycle
- permission or question flows
- provider/model/agent capability discovery
- SSE or polling fallback behavior
- fake server contract behavior

## Definition Of Done

A change is done when:

- code is in the correct layer
- behavior is preserved or intentionally updated
- tests are added or updated for changed behavior
- documentation in `docs/` is updated when behavior, architecture, or contracts changed
- validation matches the risk of the change
- the final summary states what changed, what was verified, and any remaining risk
