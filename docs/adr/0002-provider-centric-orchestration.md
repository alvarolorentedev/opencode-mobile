# ADR 0002: Provider-centric domain orchestration

- Status: Accepted
- Date: 2026-10-29
- Deciders: maintainers
- Supersedes: —
- Related: [Architecture overview](../architecture/overview.md), [State and data](../architecture/state-and-data.md), [AGENTS.md](../../AGENTS.md)

## Context

The app keeps several servers, projects, and sessions alive at once. Chat,
Projects, Settings, and Terminal must preserve continuity when the user switches
tabs. The same session state feeds the transcript, diff/todo caches, permission
and question queues, notifications, widgets, and the terminal. If each screen
owned its own fetches and stores, the app would duplicate requests, diverge on
session state, and lose work when a tab unmounts.

## Decision

Use a provider-centric domain layer.

- `providers/workspace-provider.tsx` owns the connection registry, focus, and
  app-wide persistence.
- Each retained connection/project branch mounts a `WorkspaceRuntime` composed
  by `providers/use-opencode-provider-composition.ts`.
- Domain contexts expose narrow hooks (`useChat()`, `useProjects()`,
  `useConnection()`, and so on). There is no combined runtime context value.
- Screens in `app/` are thin route controllers. Components in `components/`
  own presentation and local UI state only.
- `providers/services/` aggregates provider-facing API work. `lib/opencode/`
  owns protocol shaping and client construction.
- Shared state does not move into screens, presentational components, or new
  ad-hoc stores.

## Consequences

- Session, approval, and prompt state survive tab switches and workspace
  changes.
- SSE, polling, persistence, and notification tracking have one owner.
- The provider is the highest-risk part of the app; its size and public context
  surface are ratcheted by tests and must be split by domain rather than grown
  into a god object.
- A new feature usually needs a provider hook plus a thin screen/component, not
  a new state library.

## Alternatives considered

- **Screen-local state and fetches:** simple for one screen, but duplicates
  requests and loses continuity across tabs.
- **Redux or Zustand as a second global store:** workable, but would duplicate
  the existing provider ownership and complicate SSE/persistence ordering.
- **One context per screen:** reduces re-renders locally, but makes shared
  session and approval state inconsistent.
- **Server-state library only:** does not cover the conversation state machine,
  prompt admission, terminal transports, or local persistence rules.

## Follow-up

- [x] Keep domain contexts split and memoized.
- [x] Keep the provider entrypoint thin.
- [ ] Split any further provider growth by domain, not by screen.
