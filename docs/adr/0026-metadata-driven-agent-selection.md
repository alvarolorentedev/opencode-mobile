# ADR 0026: Metadata-driven agent selection

- Status: Accepted
- Date: 2026-11-03
- Deciders: maintainers
- Supersedes: —
- Related: [API contract](../architecture/api-contract.md), [chat components](../design/components/chat.md), [OpenCode V2 selection](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/core/src/agent.ts)

## Context

Discarding agent mode and visibility exposed hidden maintenance agents and
subagent-only agents in the primary picker. Previously saved IDs also bypassed
picker behavior during prompt and command execution. Older V1 responses and
existing capability snapshots may omit metadata entirely.

## Decision

Keep the full server catalog, but require explicit `primary` or `all` mode and
`hidden !== true` for primary selection on both protocols. Never infer eligibility
from an agent's name or missing metadata. Preserve visible subagents for mentions;
hidden agents remain available to server-owned delegation. Disabled agents are
removed by the server before listing.

Resolve stored choices against this eligible catalog, then the configured
`default_agent`, Build, and server order. Preserve preferences if no eligible
replacement exists; block prompt/command submission until eligibility is known.
Recheck at execution independently of preference reconciliation.

## Consequences

Custom and plugin agents follow the same rules as built-ins. No new state owner,
V1 adapter, or persistence format is required. Old caches remain readable and
refresh normally, but cannot establish eligibility without mode metadata.
V1 servers omitting mode no longer permit primary selection or submission;
this explicit compatibility limitation avoids guessing whether an agent is safe
to select. Servers returning metadata retain their existing execution protocol.

## Alternatives considered

- **Name blacklist:** rejects legitimate overrides and cannot cover custom internal agents.
- **Treat missing mode as selectable:** preserves older behavior but cannot establish eligibility.
- **Filter the shared catalog:** removes subagents needed by mentions and delegation.

## Follow-up

- [x] Update protocol, persistence, and chat implementation docs.
- [x] Cover selectors, execution, hydration, and browser behavior.
