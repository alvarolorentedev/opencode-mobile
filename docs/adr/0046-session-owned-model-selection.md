# ADR 0046: Session-owned model and variant selection

- Status: Superseded by ADR 0047
- Date: 2026-11-20
- Deciders: maintainers
- Supersedes: [ADR 0037](0037-per-agent-model-memory.md)
- Related: [Issue #113](https://github.com/alvarolorentedev/opencode-mobile/issues/113), [State and data](../architecture/state-and-data.md), [Functional specification](../product/functional-spec.md)

## Context

OpenCode persists the selected model and variant on each session. The app also
kept provider, model, per-agent model, and per-model variant preferences, which
could disagree with the server session and were shared across project branches.
That duplicate state caused the composer to show a different model after
switching sessions or projects.

## Decision

For OpenCode 2, `Session.model` is the source of truth for the active session's
model and variant. Composer choices call `session.switchModel` immediately;
session reads and events restore the choice. Without an explicit session model,
the server's agent/config defaults apply. The app no longer stores or migrates
global, per-agent, or per-model model/variant defaults.

Enabled/known catalog models, picker recents, auto-routing configuration and
explicit auto-routing tier choices remain app preferences. Automatic routing
may switch the session model for a routed send. OpenCode 1 has no supported
session model-switch operation, so manual model selection is limited to
OpenCode 2.

## Consequences

Changing sessions restores each session's server-owned model choice. New
sessions follow OpenCode defaults unless the user selects an override. Legacy
app model preference values are dropped during hydration rather than copied to
sessions, because one value cannot safely determine choices for many sessions.

## Alternatives considered

- **Keep app-level model defaults and synchronize them into prompts:** rejected;
  this duplicates server state and can overwrite the model stored on a session.
- **Migrate the old global or per-agent values into sessions:** rejected; a
  single old value cannot be assigned safely to every existing session.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add or update tests or fake-server coverage.
- [x] Link this ADR from the change summary.
