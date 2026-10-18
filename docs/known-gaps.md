# Known Gaps

Deliberately deferred work, with enough context to pick each item up safely.
These are known structural limits, not bugs. Fixing them changes shape rather
than behavior, so they should land one at a time with the usual validation.

Any change here that touches `tests/e2e/` or `tests/fake-opencode/` still
requires explicit human validation under `AGENTS.md`.

## 1. Provider and chat orchestration wiring

`providers/opencode-provider.tsx` is the single orchestrator and remains the
app's main coupling hotspot. It currently sits near the architecture
ratchet limits enforced by `tests/vitest/architecture.test.ts`:

- the provider file is 477 lines (`MAX_LINES` = 500), and
- the combined domain-context surface is **exactly 135 members**
  (`contextMembers <= 135`).

The caps are doing their job, but the pressure shows up as relocation rather
than reduction:

- `OpencodeProvider` spreads `...state` (and, further down, `...project`,
  `...sessionActions`, `...prompt`, ...) into roughly twenty `use*` hooks, then
  re-assembles the context values.
- `providers/opencode-provider-action-inputs.ts` and
  `providers/opencode-provider-values-input.ts` exist mainly to describe those
  spreads without exceeding the line budget.

The chat surface has the same shape one level down:

- `components/chat/use-chat-view-controller.ts` returns ~85 flat members.
- `components/chat/chat-view.tsx` re-destructures them and forwards ~50 props to
  `ChatContent`.
- `components/chat/content/chat-content.tsx` is a pure pass-through that forwards
  ~27 more props to `TranscriptList` / `ChangesOverlay` / `PendingInteractions`.
- Meanwhile `components/chat/chat-library.tsx` and several settings components
  read the provider contexts directly, so the convention is not uniform.

Direction to consider (do not invent a new architecture):

1. Remove the `ChatContent` pass-through: render the three leaves directly in
   `ChatView`, or let each leaf read the domain context it needs, matching
   `chat-library.tsx`.
2. Group `useChatViewController`'s output into cohesive namespaces (`content`,
   `composer`, `overlay`, `actions`) to shrink the flat 85-field surface.
3. Extract the nested context-provider tree and the `...state` spreading from
   `opencode-provider.tsx` into a dedicated composition unit, then **lower** the
   ratchet numbers in the same change (per the rule in `docs/architecture.md`).

React Compiler is enabled (`app.config.ts`), so measure re-render behavior before
attempting any selector-based subscription model; the memoized domain values may
already be sufficient.

## 2. Test infrastructure leftovers

The standalone Node `.mjs` suites were consolidated into `tests/vitest/`
(see `TESTING.md`). Three items remain:

- **Test files are not type-checked.** `tsconfig.json` excludes `tests/vitest`,
  and the suites intentionally drive the dynamic `loadTs` / `hookRuntime` harness
  in `tests/helpers/runtime.mjs`, which returns untyped module shapes. Running
  `tsc` over `tests/vitest` today reports hundreds of type-only errors
  (dominated by `connect.test.ts`, `provider-runtime.test.ts`,
  `connect-recovery.test.ts`). Making this a gate means either fixing all of them
  or blanket `// @ts-nocheck`, neither of which clearly pays for itself. The
  suites are exercised by running them; app-side types are still checked.
- **`tests/foss-prepare.test.mjs`** is still a standalone Node script
  (`npm run test:foss`, run by the `foss-release` CI job). It was left out of the
  Vitest include because it mutates a temporary `node_modules` tree and is build
  tooling rather than app behavior.
- **The Playwright specs are monolithic.** `tests/e2e/flows.spec.mjs` is ~2,250
  lines and `tests/e2e/connect.spec.mjs` is ~950 lines, with ~30 shared helpers
  defined at the top of `flows.spec.mjs`. Splitting them by domain (extracting a
  `tests/e2e/helpers/` module first) is mechanical but must be validated by a
  full `npm run test:e2e:web` run, which is why it was not done blind.

## 3. CI duplication and observability

- **Duplicated `validate` job.** The same validate steps (static checks,
  fake-server self-test, Playwright) are copy-pasted in
  `.github/workflows/pr-validate.yml`, `build.yml`, and `ios-release.yml`. The
  iOS workflow even carries a comment about drift risk. Extract a reusable
  workflow (`workflow_call`) and have the three callers depend on it.
- **No remote crash/error reporting.** `lib/error-reporting.ts` writes the last
  JS error to a local file under the app's documents directory and delegates to
  the previous handler. There is no remote crash/error pipeline, so release-time
  failures can only be diagnosed from a user's device or the Settings
  diagnostics surface. Adding an opt-in reporter (for example Sentry) behind the
  existing diagnostics surface, and surfacing the recorded `LAST_JS_ERROR` in
  Settings → Diagnostics, would close the loop.
