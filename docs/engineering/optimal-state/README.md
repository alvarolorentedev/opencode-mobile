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
| B | [Connection manager](phase-b-connection-manager.md) | Complete | Core-owned connection managers run probe, renewal, SSE and polling |
| C | [Command core](phase-c-commands.md) | Complete | Cross-domain commands run in the app core and the legacy composition is deleted |
| D | [Transcript](phase-d-transcript.md) | Complete | Per-session infinite messages, bounded Query persistence and store live overlay |
| E | [Flatten React](phase-e-flatten-react.md) | In progress | No scope/provider tree or shared-UI runtime exception |
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
  through `runtime/core/workspace-selectors.ts`.
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
- B3a, `3c72d13d`. The commit gate reported 1,259 passing tests and one existing skip.
  The 11 focused tests, docs, web export and all 60 Cloud Link, manual
  connection and network resilience browser tests passed. The retry policy
  suite verifies the attempt budget, the radio settling delay and cancellation.
- B3b, `e1c23b7f`. The commit gate, nine focused tests, docs, both fake-server self-tests,
  and the development web export passed. All 72 connection, realtime,
  network resilience and multi-server browser tests passed. The realtime
  test joins a second project to the same SSE subscription and verifies
  directory isolation.
- B4 and Phase B gate, `1976abce`. Catalog projections and retained projects no longer
  share a connection provider. The commit gate reported 1,259 passing tests
  and one existing skip. The focused tests, docs, both fake-server self-tests
  and development web export passed. All 185 browser tests passed, including
  live Restore, credential rotation, reconnect and fallback polling. The
  original failing checkout was unavailable locally. Physical network handoff
  remains device acceptance.
- C1, `3d0ece8c`. The app core owns workspace readiness, navigation and chat creation.
  Static checks passed with 1,261 tests and one existing skip. The 21
  focused tests, docs, web export and all 34 sessions, projects,
  multi-server and terminal browser tests passed.
- C2a, `f3db22d7`. Permission and question replies run through scoped session commands.
  The commit gate passed with 1,262 tests and one existing skip. The 28
  focused tests, docs, web export and all 27 interaction, multi-server and
  realtime browser tests passed, including colliding approvals on two servers.
- C2b, `1ee42b32`. Session opening and bootstrap are app-core commands. The static gate
  passed with 1,262 tests and one existing skip. The 27 focused tests, docs,
  web export and all 67 browser tests across chat, sessions, projects,
  multi-server and onboarding passed. The tests retain checks for a
  superseded bootstrap, cached windows and delayed hydration.
- C2c, `3407fd31`. Session creation and forking use app-core commands and a shared
  Query catalog writer. The commit gate passed with 1,264 tests and one
  existing skip. The 29 focused tests, docs, web export and all 67 owning
  browser tests passed, including server defaults and model selection.
- C2d, `1cfc35c0`. Rename, delete, revert and unrevert use scoped app-core commands.
  Static checks passed with 1,266 tests and one existing skip. The focused
  tests, docs, web export and all 53 chat, sessions, diffs, interactions
  and multi-server browser tests passed.
- C2e, `d4e3a6ab`. Session list, status and approval refreshes run as scoped commands
  against manager-owned clients. Static checks passed with 1,267 tests and
  one existing skip. The 46 focused tests, docs, web export and all 90
  Cloud Link, realtime, network, interactions, sessions and multi-server
  browser tests passed.
- C3a, `e45a7f86`. App-core commands own prompt submission and abort tokens. Static
  checks passed with 1,267 tests and one existing skip. The 45 focused
  tests, docs, web export and all 55 chat, auto-model, network, multi-server,
  realtime, interactions and diffs browser tests passed.
- C3b, `18b07c5e`. App-core prompt commands own inbox admission, cancellation and
  reconnect recovery. The commit gate passed with 1,268 tests and one existing
  skip. The 63 focused tests, docs, web export and all 92 chat, Cloud Link,
  network, realtime and multi-server browser tests passed. The focused race
  check rotates credentials during admission and verifies no stale Query write.
- C3c, `c59c21ca`. Prompt routing and task settlement run in plain commands. The commit
  gate passed with 1,270 tests and one existing skip. The 90 focused tests,
  docs, web export and 60 chat, auto-model, settings, onboarding, network and
  multi-server browser tests passed. Settlement tests cover credential changes
  and the fast completion path after observing a busy status.
- C4, `386dca9a`. The connection core owns explicit actions, saved profile activation,
  registry restoration, credential edits and failover. The commit gate passed
  with 1,271 tests and one existing skip. The 207 focused tests, docs, web
  export and 97 browser tests passed across Cloud Link, manual connections,
  multi-server, network, onboarding and Settings.
- C5, `51c5ff3e`. Core event dispatch reads the current app store and the realtime owner
  coalesces project refreshes. The commit gate passed with 1,274 tests, one
  existing skip and no lint warnings. The 82 focused tests, both fake-server
  self-tests, docs, web export and all 56 chat, diffs, interactions, multi-server,
  network, realtime and terminal browser tests passed.
- C6a, `3946a79e`. Saved links and cross-server favorites run through the connection core.
  Feature hooks bind commands directly and the root action overrides are gone.
  The commit gate passed with 1,275 tests and one existing skip. The 43 focused
  tests, docs, web export and all 88 chat, sessions, projects, multi-server,
  interactions, onboarding and Settings browser tests passed.
- C6b, `8d8186bd`. Feature views replace the legacy project composition and value
  builders. Session link validation and local-send tracking run in the core.
  The initial full browser run exposed an inbox race that combined a delivery
  with the ID of a later enqueue. The fix preserves the delivery ID and checks
  that the server inbox no longer contains it. The final commit gate passed
  with 1,276 tests, one existing skip and no lint warnings. The 143 focused
  tests, docs, both fake-server self-tests, web export and all 185 browser
  tests passed after the fix.
- D1, `e2d4c9c5`. Canonical transcript windows now use scoped per-session infinite
  queries. Existing page-read and live-overlay policies stayed in place.
  The 58 focused tests, docs, web export, 67 browser tests and the local commit
  gate passed with 1,279 tests and one existing skip. The 8 MiB attachment
  comparison reached every delta with the same first visible update and
  comparable commit lag.
- D2, `450524f9`. Query persistence restores scoped, media-free transcript tails without
  reusing a server paging cursor. Only the legacy upgrade reader remains for
  old disk entries. The full browser suite passed all 185 flows. The local
  commit gate passed with 1,280 tests and one existing skip. In the paired
  8 MiB attachment benchmark, both builds had a 20–22 ms p95 visible delta lag.
  The median cold transcript render was 174 ms versus 168 ms on Phase C.
- E1a, `3139adff`. The terminal screen and retained renderers receive explicit workspace
  targets. The initial browser run found that a focused chat transition could
  briefly replace the retained PTY's runtime. Explicit selections now read
  their own project projection. The corrected build passed the commit gate
  with 1,280 tests and one existing skip, 34 focused tests, and all 24 Terminal,
  multi-server and Settings browser flows.
- E1b, `3866c7e4`. Settings passes its inspection target through feature panels and dialogs.
  Shared portals keep their modal hosts and carry explicit feature props. The
  workspace scope contexts are deleted. The commit gate passed with 1,280 tests
  and one existing skip. Storybook, web export and all 101 multi-server,
  Settings, Connect, extensions, onboarding and interactions browser flows passed.
- E1c, `29908afb`. The Updates feature supplies interaction registration through control
  props. Shared UI imports only shared dependencies. ADR 0052 replaces the
  previous exception. The commit gate passed with 1,280 tests and one existing
  skip. The 59 focused Vitest cases, Storybook, web export and all 49 update,
  chat, Settings and multi-server browser flows passed.
- E2a, `37be0f0a`. Focused and explicitly targeted views now use one project projection.
  Workspace actions read the app core, and a separate chat draft adapter
  consumes app-wide share receipts. The commit gate passed with 1,280 tests
  and one existing skip. The 60 focused Vitest cases, web export, and all 55
  share, chat, multi-server, project, session and terminal browser flows passed.
- E native terminal, `2138e63b`. Simulator creation exposed an Expo DOM ref whose methods
  were unavailable while the setup sheet was closing. The corrected build
  created the terminal and retained its output and single WebSocket connection
  across tab switches. The commit gate passed with 1,280 tests and one existing
  skip, and all 12 Terminal and multi-server browser flows passed.
- E2b, `c7f8ea93`. A server URL edit changes focus and retires the previous project
  projection in one store update. The Settings and Terminal panes resolve their
  own ready keys. The commit gate passed with 1,281 tests and one existing
  skip. The 26 focused Vitest cases, web export and all 104 connection,
  Settings, multi-server, project, session and Terminal browser flows passed.
- E3, `8462344c`. Connection, transcript, file and catalog hooks receive the exact Query
  identity and demand through arguments. The app keeps one Query provider
  and subscribes to foreground changes through the focus manager. The commit
  gate passed with 1,281 tests and one existing skip. The 86 focused Vitest
  cases, web export and all 72 affected browser flows passed.
- E4a, `5b8abdcb`. Onboarding reads registry hydration and review state from the app store.
  The commit gate passed with 1,281 tests and one existing skip. All 35 focused
  tests, the web export and all 33 onboarding, Settings and manual connection
  browser flows passed.
- E4b, `75e29e31`. The combined domain type file is gone. Feature contracts live with their
  owners, and shared transcript reads and service management use dedicated
  contracts. The commit gate passed with 1,281 tests and one existing skip.
  Focused Vitest passed 470 tests with one existing skip. Web export and 89
  Connect, project, session, multi-server and diff browser flows passed.
- E4c, `f6d33d49`. Preference controls read scoped choices from the store and reconcile
  model selections against the exact Query partition. The shared preferences
  context and the per-project preference projection are gone. The commit gate
  passed with 1,282 tests and one existing skip. All 59 focused tests and 58
  auto-model, Settings, multi-server, onboarding and Chat browser flows passed.
  Android API 36 smoke verified hardware Back through connection setup and
  the onboarding provider setup and selector screens.
- E5, `ce934e2b`. PTY lifecycle commands moved to a plain scoped controller. The commit
  gate passed with 1,282 tests and one existing skip. All 43 focused tests and
  12 Terminal and multi-server browser flows passed. The Android emulator
  retained its PTY output and WebSocket across tabs after loading the new bundle.
- E6, `157f0958`. The core observes scoped pending approvals and applies each connection's
  V2 policy. Settings replies in the request's own project without reading
  workspace projections for pending items. The commit gate passed with 1,282
  tests and one existing skip. All 74 focused tests and 106 Connect, interaction,
  multi-server, onboarding, realtime and Settings browser flows passed.
- E7, `4c401664`. The core owns retained terminal controllers and credentials. The first
  browser run exposed a lost renderer after disconnecting and re-enabling a
  server. The corrected controller pauses the transport and retains its renderer.
  The commit gate passed with 1,282 tests and one existing skip. All 58 focused
  tests and 32 Terminal, multi-server, Settings, auto-model and update browser
  flows passed. Android retained the displayed output and one WebSocket across tabs.
- E8, `f347f1b9`. The single NetInfo listener publishes connectivity into the app store.
  Diagnostics reads connection retry and stream state directly and uses Query
  for server health and MCP details. The commit gate passed with 1,282 tests and
  one existing skip. All 127 focused tests and 54 network, realtime, Settings,
  Chat, multi-server and Terminal browser flows passed.
- E9. Extension views use the scope selector and guard writes after cancelling
  pending reads. Diagnostics shares the selector. The commit gate passed with
  1,283 tests and one existing skip. All 143 focused tests and 45 extension,
  Settings, Chat and multi-server browser flows passed. The final scope guard
  passed all 13 extension and multi-server flows on a fresh build.

## Loop protocol

1. Read this index and the earliest phase whose status is not complete.
2. Verify the repository is clean and the baseline gate is green.
3. Work only on that phase. Do not start the next phase with a red gate.
4. Commit the phase or sub-phase with a focused message.
5. Update the phase status row in this index in the same commit.
6. Run the phase gate. If it fails, fix it and rerun; never lower a budget,
   skip a suite, or add retries.
7. Continue from the next phase.

At checkpoints B through G run the full browser suite:

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
- [x] Connection transport/probe/renewal/SSE/polling are plain TS; no React
      component mounts a transport.
- [x] Cross-domain commands are plain functions; `use-opencode-provider-composition.ts`,
      `opencode-provider-values*.ts`, `eventActionsRef` and `WorkspaceRuntime`
      are deleted.
- [x] Messages use per-session infinite queries; the live overlay is in Zustand.
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
