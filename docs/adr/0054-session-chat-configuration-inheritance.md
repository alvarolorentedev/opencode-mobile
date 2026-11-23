# ADR 0054: Session chat configuration inheritance

- Status: Accepted
- Date: 2026-11-23
- Deciders: maintainers
- Supersedes: [ADR 0047](0047-new-session-last-used-model.md)
- Related: [State and data](../architecture/state-and-data.md), [Functional specification](../product/functional-spec.md), [Chat](../design/components/chat.md)

## Context

ADR 0047 made a new chat start on the last model picked from the composer. It
kept the session model server-owned but did not carry the agent, did not carry a
reasoning variant, and left the composer agent on the connection-wide `mode`
preference. Opening an existing chat could therefore show a different agent than
the session used, and the next send silently switched the server session back to
the global choice.

OpenCode 2 also exposes session-owned permissions and accepts `agent`, `model`
and `permissions` in the session create call. Copying those values after create
would take multiple requests and leave a visible default configuration in the
meantime.

## Decision

A new chat is created with the configuration of the newest non-subagent session
in the same project: its agent, its model including the reasoning variant, and,
when auto-approve is off, its V2 permission ruleset. The values are sent in the
single `session.create` call. A model that is no longer in the catalog is
dropped so the server default applies.

Open sessions are read from the session first: `Session.agent`,
`Session.model`/variant and the server-owned ruleset. The newest user message's
recorded agent and model are a field-level fallback only when the session has
none. Auto-approve stays the connection preference and takes precedence over
the session ruleset: when it is enabled, new chats do not copy rules.

Selecting an agent in an existing chat writes through `session.switchAgent`
immediately, mirroring the model picker's `session.switchModel`. The app keeps
no per-session agent map.

These rules apply to OpenCode 2. V1 keeps its title-only creation path.

## Consequences

Every creation path (header, new-chat sheet, worktree, quick action, share and
bootstrap) inherits the same way because the resolver lives in the session
creation service. Creation is one request instead of a create followed by a
model switch, so a chat never renders with a default then changes underneath the
user.

The project session catalog must be loaded for inheritance to be available. If
it is empty or the newest session has no usable model, the existing recent-model
fallback is used and then the server default. Copying a permission ruleset is a
deliberate carry-over of allow/ask rules within the same project; auto-approve
remains the explicit opt-out.

## Alternatives considered

- **Keep the recent-model preference:** rejected; it cannot carry the agent,
  variant or permission ruleset and diverges from the session the user just used.
- **Switch agent and model after create:** rejected because permissions can only
  be set during creation, and partial configuration would be visible.
- **Per-agent model memory:** rejected; the requirement is the last session, not
  a second global table that can disagree with the server.
- **Copy the ruleset over auto-approve:** rejected; the user's explicit
  auto-approve choice takes precedence.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add or update tests or fake-server coverage.
- [ ] Link this ADR from the change summary.
