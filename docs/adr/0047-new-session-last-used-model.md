# ADR 0047: New sessions start on the last picked model

- Status: Accepted
- Date: 2026-11-20
- Deciders: maintainers
- Supersedes: [ADR 0046](0046-session-owned-model-selection.md)
- Related: [State and data](../architecture/state-and-data.md), [Functional specification](../product/functional-spec.md)

## Context

ADR 0046 made `Session.model` the source of truth and left new sessions on the
server's agent/config default. In practice a user who picks a model for one chat
expects the next new chat to keep it; otherwise every new chat silently returns to
a different default and the picker must be used again.

The picker already records recents in `chatPreferences.recentModelIds` when the
user selects a model. That value is per connection profile and does not duplicate
the per-session choice ADR 0046 established.

## Decision

On OpenCode 2, a newly created session starts on the most recent picker choice
(`recentModelIds[0]`) when that model is still in the catalog. Session creation
calls `session.switchModel` once, so the server keeps owning the value and every
later read, command and prompt uses the normal session model path.

The default is best effort and only applies at creation:

- no recent model, a removed/disabled model, OpenCode 1, or a failed switch leaves
  the server's agent/config default in place;
- the switch never blocks or fails chat creation;
- existing sessions are never overridden;
- variants are not remembered, because the recent list stores model IDs only.

Everything else in ADR 0046 stands: `Session.model` remains the single source of
truth, the picker writes through `session.switchModel`, and the app keeps no
global, per-agent or per-model model defaults.

## Consequences

New chats open with the user's last choice without extra taps, while each chat
still owns its model afterwards. The server remains authoritative and the app
stores only the existing recents hint.

The implementation lives in the session creation action, so every path that makes
a session (header button, new-chat sheet, worktree chat, quick action, share,
bootstrap) follows the same rule. A failed default is silent by design; the chat
still opens.

## Alternatives considered

- **Read-time fallback in the model resolver:** rejected; the composer would show
  a model the server does not use for the first prompt until a switch happens.
- **Store a global or per-agent default:** rejected by ADR 0046; it duplicates
  server state and can disagree with the session.
- **Use the most recent session's model:** rejected; it can come from another
  project and includes auto-routed choices the user did not pick.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add or update tests or fake-server coverage.
- [x] Link this ADR from the change summary.
