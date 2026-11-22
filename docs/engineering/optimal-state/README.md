# Optimal State Implementation Phases

Self-contained execution plan for finishing the two-tier architecture described
by [ADR 0051](../../adr/0051-app-core-state-tiers.md). Each phase has its own
document, file inventory, steps, gates, and definition of done so a loop agent
can implement it without prior conversation history.

Read [state and data](../../architecture/state-and-data.md) first, then the
phase you are executing. Do not preload every phase unless you are planning.

## The rule

> **Server says it → TanStack Query. User or device says it → Zustand.
> No third store, no DI container, no state-machine library.**

- One app core in `runtime/core/create-app-core.ts`.
- One Query client for server facts.
- One Zustand store for device facts.
- Commands are plain functions with explicit ports.
- Feature presentation reads selectors; it never imports the store or Query.

## Phase index

| Phase | Document | Status | Outcome |
| --- | --- | --- | --- |
| A | [State evacuation](phase-a-state-evacuation.md) | Complete | No domain data in per-workspace React state |
| B | [Connection manager](phase-b-connection-manager.md) | In progress | Transport, probe, renewal, SSE and polling are plain TS |
| C | [Command core](phase-c-commands.md) | Not started | Cross-domain commands are plain functions; composition deleted |
| D | [Transcript](phase-d-transcript.md) | Not started | Per-session infinite messages + store live overlay |
| E | [Flatten React](phase-e-flatten-react.md) | Not started | No scope/provider tree or shared-UI runtime exception |
| F | [Persistence and tests](phase-f-persistence-and-tests.md) | Partially done | Query persistence done; Zustand persist, `loadTs`, `fast-check`, `knip` remain |
| G | [Harness and guardrails](phase-g-harness-and-guardrails.md) | Not started | Full composition harness, fact rules, docs, release validation |

## Current baseline

Completed before this plan:

- Zustand store and Query client mounted once by `runtime/core/create-app-core.ts`.
- Session lists, statuses, approvals, messages, diffs, todos and VCS diffs are
  Query-owned; the custom session cache is deleted.
- Registry/focus, selection, active project, presentation, chat UI, MCP prompt
  and focused values are store-owned.
- The feature domain context/provider tree is gone; scope values are selected
  through `runtime/core/workspace-scope.ts`.
- The connection state machine is a plain manager; its effects are still React.
- Query persistence for session and project catalogs is enabled.
- `npm run impact -- <file>` lists dependent tests.
- Prompt sending/error and transcript read errors are store-backed (Phase A1).

Baseline is green: `npm run validate:commit`, 185 browser flows, clean tree.
Verify before starting:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
git status --short
npm run validate:commit
```

## Execution journal

- `d1115184` baseline on Node 22.23.3. `npm ci` and `npm run validate:commit`
  passed from the clean tree. Vitest reported 1,253 passing tests and one
  existing skip. ESLint reported 36 existing warnings.
- A2, `c43ebf70`. Static
  checks, docs, the development web export, and 31 browser tests across chat,
  interactions and network resilience passed. The focused Vitest run covered
  the inbox, the app store and feature boundaries. The impact command found no
  affected suites because the inbox suites still use the legacy loader.
- A3, `aa062d6e`.
  The commit gate reported 1,255 passing tests and one existing skip. The
  voice and provider suites, fake-server self-test, docs, web export and 47
  browser tests across chat, onboarding and settings passed. Physical speech
  recognition and playback still require device acceptance.
- A4, `00539212`. The
  commit gate, focused terminal and provider tests, docs and web export passed.
  All 12 terminal and multi-server browser tests passed, including retained
  renderer and colliding PTY ID coverage. Native terminal input and screen
  reader behavior still require device acceptance.
- A5, `2b3110c4`.
  The commit gate reported 1,256 passing tests and one existing skip. The
  46 focused tests, docs, web export, and all 35 chat, diffs, realtime and
  network resilience browser tests passed. A fake-clock test verified one
  grouped paint at 50 ms with an optimistic attachment. Comparative latency
  and cold-start measurement remain part of Phase D.
- A6, `5d5ad465`.
  The commit gate, 144 focused tests, docs and web export passed. All 49 chat,
  settings, extensions, projects and auto-model browser tests passed. The
  credential partition test verifies that an old classifier result does not
  carry into a new credential generation.
- A7 and Phase A gate, `97a2e854`.
  Static checks passed with 1,256 tests and one existing skip. The 139 focused
  tests, docs, fake-server self-tests and web export passed. All 95 browser
  checks passed across the Phase A gate and the affected diffs, projects,
  onboarding and settings specs.
- Phase B baseline from the Phase A export passed the live renewal, credential
  rotation and second-device Restore scenarios in `connect.spec.mjs`.
- B1, `63e58c7c`.
  The commit gate reported 1,257 passing tests and one existing skip. The
  focused lifecycle and Cloud Link recovery tests, docs, web export and all 72
  connection, realtime, network resilience and multi-server browser tests
  passed, including live renewal across panel reopening.
- B2, `ef2c2c1a`. The commit gate reported 1,258 passing tests and one existing skip.
  The 19 focused tests, docs, web export and all 68 Cloud Link, manual
  connection and multi-server browser tests passed. The registry test covers
  revision changes, credential partitions, disable, removal and teardown.
- B3a. The commit gate reported 1,259 passing tests and one existing skip.
  The 11 focused tests, docs, web export and all 60 Cloud Link, manual
  connection and network resilience browser tests passed. The retry policy
  suite verifies the attempt budget, the radio settling delay and cancellation.

## Loop protocol

1. Read this index and the earliest phase whose status is not complete.
2. Verify the repository is clean and the baseline gate is green.
3. Work only on that phase. Do not start the next phase with a red gate.
4. Commit the phase or sub-phase with a focused message.
5. Update the phase status row in this index in the same commit.
6. Run the phase gate. If it fails, fix it and rerun; never lower a budget,
   skip a suite, or add retries.
7. Continue from the next phase.

At checkpoints B, C, E, F, G run the full browser suite:

```bash
EXPO_PUBLIC_E2E_MODE=1 EXPO_APP_VARIANT=development npm run build:web:ci
E2E_SKIP_BUILD=1 npx playwright test
```

The Playwright webServer build can exceed its 180-second timeout. Build manually
first, then use `E2E_SKIP_BUILD=1`.

## Global invariants

- Server facts only in Query; never mirror a Query response into Zustand.
- Device facts only in Zustand; no third cache.
- One writer per fact. A feature `queries.ts`, `selectors.ts` or `commands.ts`
  owns the write path; presentation reads selectors.
- Commands are plain TS. Hooks may adapt, not own cross-domain behavior.
- No server-data `useState` outside Query.
- No shared UI imports runtime.
- Test edits under `tests/e2e/` and `tests/fake-opencode/` require explicit human
  validation even when automation passes.

## Definition of done

- [ ] `createAppCore` owns store, Query client, connection registry, commands,
      event handler and dispose.
- [ ] Connection transport/probe/renewal/SSE/polling are plain TS; no React
      component mounts a transport.
- [ ] Cross-domain commands are plain functions; `use-opencode-provider-composition.ts`,
      `opencode-provider-values*.ts`, `eventActionsRef` and `WorkspaceRuntime`
      are deleted.
- [ ] Messages use per-session infinite queries; the live overlay is in Zustand.
- [ ] No `WorkspaceScope`, `WorkspaceValues`, `valuesFor` or shared-UI runtime
      exception remains.
- [ ] Query and Zustand persistence own retention; no duplicate caches or
      writers.
- [ ] No `loadTs`/`hookRuntime`; `fast-check` and `knip` are in use.
- [ ] Full fake-server composition harness and fact/command guardrails exist.
- [ ] `npm run validate:commit`, full 185-flow E2E, Storybook and native smoke
      pass on the final commit.

## Pitfalls

- **Live renewal:** a previous connection-manager extraction left Restore
  disabled after credential renewal. Phase B must keep `connect.spec.mjs` green.
- **Transcript performance:** Phase D is the only performance-sensitive rewrite;
  measure the 50 ms overlay before committing.
- **Portal scope:** Phase E can break overlays, sheets and keyboard behavior; run
  Storybook and the affected E2E.
- **Test-loader migration:** compare test identities when moving off `loadTs`;
  do not silently drop assertions.
- **Persistence:** never persist inline message media. Verify cold start and tab
  switching.
- **E2E build timeout:** build manually, then `E2E_SKIP_BUILD=1`.
