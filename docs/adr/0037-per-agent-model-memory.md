# ADR 0037: Per-agent model memory and explicit auto-model thinking levels

- Status: Accepted
- Date: 2026-11-05
- Deciders: maintainers
- Supersedes: —
- Related: [Auto model routing](../product/auto-model-routing.md), [Chat components](../design/components/chat.md), [Onboarding components](../design/components/onboarding.md)

## Context

Chat stored one server-scoped `modelId` for every agent. Switching from Build to
Plan therefore reused Build's model, and onboarding asked for a global default
before the user had seen how agents differ. Model variants (thinking levels)
were selectable in the composer, but auto-model tiers could only choose a model,
not the level used when routing to that model.

## Decision

`ChatPreferences.agentModelSelections` stores the latest model ID per agent.
Selecting a model writes the current agent's entry; switching agents resolves
that agent's entry. An agent without an entry sends no explicit model so the
server/agent default applies. Existing `modelId` values are migrated once to the
current agent.

Auto-model tiers keep their model preference and gain
`tierVariants: Record<'simple' | 'standard' | 'complex', string | null>`. A valid
tier variant overrides the per-model variant for routed sends; an unsupported
value falls back to `modelVariantSelections` or the model default without
blocking routing.

Both maps are server-scoped through the workspace registry and saved connection
profiles. Onboarding no longer writes a default model.

## Consequences

Switching agents restores the expected model and sending with an unconfigured
agent keeps the server default. Users who relied on one global default get that
model assigned to the agent that was active during the upgrade.

Model catalogs can be temporarily incomplete; stored IDs remain in preferences
and are validated at send time. Agent-specific variants are not stored; thinking
levels remain per model plus the optional auto-tier override.

## Alternatives considered

- **Keep one global model:** rejected; it breaks the agent workflow the composer
  already exposes.
- **Store full provider/model/variant objects per agent:** rejected; model IDs
  already include the provider, and variants have an existing per-model map.
- **Force a default model during onboarding:** rejected; the server already has
  an agent/config default, and the choice belongs in the composer per agent.

## Follow-up

- [x] Update the affected implementation docs.
- [x] Add or update tests.
- [ ] Link this ADR from the change summary.
