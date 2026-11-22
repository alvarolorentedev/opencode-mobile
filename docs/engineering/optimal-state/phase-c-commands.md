# Phase C — Command Core

Status: **in progress**. The app core owns the workspace commands for readiness,
navigation, independent project targets, and chat creation. Retained project
publications still supply session and worktree actions while those domains are
migrated.

Permission and question replies now run as plain session commands. Permission
reconciliation reads pending mutations in the same Query partition as the
project's approvals. Session list, status and approval refreshes also run
through these commands. Sending and aborting use app-core prompt commands.
Inbox admission, reconnect recovery, routing and settlement still include
React adapters. Connection commands and event dispatch remain.

Explicit session opening and automatic bootstrap share the app-core selection
command. It reads the project session catalog and supersedes pending bootstrap
when the user opens a chat. Creation and forking share scoped Query writes
and use the saved model when the demanded project's catalog supports it.
Rename and delete are scoped commands, and revert settles execution before
staging the rewind. The retained project still supplies transcript reads.

Goal: cross-domain behavior becomes plain TypeScript commands. Hooks adapt;
they no longer own command logic. The per-workspace composition and its value
mirrors are deleted.

Read the [phase index](README.md), [feature boundaries](../../architecture/feature-boundaries.md),
and [ADR 0051](../../adr/0051-app-core-state-tiers.md) first.

Start only after Phase B is complete and green.

## Target files

New command modules:

```text
runtime/core/commands/connection.ts
runtime/core/commands/workspace.ts
runtime/core/commands/session.ts
runtime/core/commands/prompt.ts
runtime/core/events.ts
```

The command context is the only dependency surface:

```ts
type CommandContext = {
  store: AppStore;
  queryClient: QueryClient;
  connections: ConnectionRegistry;
  clock: () => number;
};
```

No React imports in these modules.

## Commands to extract

Connection:
- connect, disconnect, switch connection, retry, activate saved profile.

Workspace:
- select project, activate project, navigate to session, open external session,
  create chat, create worktree chat.

Session:
- ensure active session, open session, create/delete/rename/fork/revert/unrevert,
  refresh session list/statuses, reply to permission/question.

Prompt:
- send prompt, abort session, admission/queue recovery, mark local send,
  reconcile settlement.

Move the logic, not a wrapper. Each command should be callable in a plain test
with a fake context.

## Delete after extraction

Existing files that must be gone or reduced to thin adapters by the end of the
phase:
- `runtime/composition/use-opencode-provider-composition.ts`
- `runtime/composition/opencode-provider-values.ts`
- `runtime/composition/opencode-provider-values-input.ts`
- `runtime/workspace/workspace-runtime.tsx`
- `eventActionsRef` and its latest-ref mirrors in the composition
- `WorkspaceValues`/`useWorkspaceValues` action overrides
- read-generation guards that Query keys already protect

Feature hooks may keep local UI state only. If a hook still needs a command, it
receives it from a feature selector or calls the command with the context.

## Steps

1. Create the command context and registry types.
2. Extract one domain at a time, starting with workspace navigation, then
   sessions, then prompts, then connection commands.
3. For each command:
   - move the logic and its unit tests;
   - keep error handling and trust validation;
   - add a plain context test;
   - run `npm run impact -- <changed-file>`.
4. Replace call sites with commands/selectors.
5. Delete the composition and value builders. Remove now-unused event action
   objects.
6. Ensure the event handler is plain TS and receives explicit ports.

## Phase C gate

```bash
npm run validate:commit
EXPO_PUBLIC_E2E_MODE=1 EXPO_APP_VARIANT=development npm run build:web:ci
E2E_SKIP_BUILD=1 npx playwright test tests/e2e/chat.spec.mjs tests/e2e/sessions.spec.mjs tests/e2e/projects.spec.mjs tests/e2e/multi-server.spec.mjs tests/e2e/interactions.spec.mjs
```

Full 185-flow suite required at this checkpoint.

## Acceptance

- No `use-opencode-provider-composition.ts`, no `opencode-provider-values*`.
- No `WorkspaceRuntime` or per-workspace composition hook.
- No `eventActionsRef` or latest-value mirror used as command state.
- Every command has a plain-TS test and an owning E2E flow.
- Presentation imports selectors/commands, never the store or Query internals.

## Pitfalls

- Do not move state and commands in the same commit; state is Phase A/B.
- Keep credential/auth guards and operation generations that Query keys do not
  cover (streams and imperative calls).
- Do not add a container or a second store to avoid explicit ports.
- Keep command modules free of React so tests stay fast.
