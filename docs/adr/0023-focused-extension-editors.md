# ADR 0023: Focused extension editors with structured authoring

- Status: Accepted
- Date: 2026-11-01
- Deciders: maintainers
- Supersedes: —
- Related: [Settings components](../design/components/settings.md), [Functional specification](../product/functional-spec.md#extensions-section-v2), [API contract](../architecture/api-contract.md#extensions-and-config-files), [ADR 0022](0022-markdown-first-extension-definitions.md)

## Context

Extension lists were preceded by inline creation forms and configuration paths.
Choosing an agent model required a provider/model string, local MCP setup
required a JSON argument array, and editing skills required the whole source.
The app already owns model catalogs, searchable pickers, scoped overlays and
safe definition mutations; another state owner or configuration format is not
needed.

## Decision

Show each extension inventory first and open focused editors in the existing
workspace-scoped overlay infrastructure. Agents, skills and commands separate
Setup from Instructions without saving or resetting when switching tabs.

- Agent model selection reuses the public AI picker, including inheritance,
  catalog search and variants. Custom IDs remain under Advanced. Editing an
  extension does not change chat model preferences.
- Local MCP setup collects an executable and separate literal arguments. It
  never parses a shell command. Remote setup collects an HTTP(S) URL.
- V2 permissions use ordered action/resource/effect rows. Legacy or custom
  shapes remain source-editable without implicit conversion.
- Skill structured edits retain unknown YAML fields and comments. Advanced
  source editing remains available. Existing IDs and storage formats stay
  stable unless an existing explicit rename operation is used.
- Dirty editor dismissal requires confirmation; failed writes retain the draft.
  Configuration paths and backup recovery live in a disclosure, while blocking
  safety warnings stay visible.

## Consequences

The common setup path no longer requires configuration syntax. Protocol codecs
remain responsible for serialization and preservation; feature forms forward
existing domain actions. Optional AI picker inputs retain existing chat behavior.
This supplements ADR 0022 and does not migrate definitions or change endpoints.
Preservation tests and existing extension/settings/chat flows cover the new UI;
native keyboard, Back and screen-reader behavior still need human acceptance.

## Alternatives considered

- **Keep inline forms and replace only the model field:** leaves existing
  extensions below creation forms and preserves the other syntax-heavy inputs.
- **Convert all configuration to a new simplified schema:** risks losing custom
  fields, rule ordering and storage precedence.
- **A mandatory creation wizard:** adds steps to repeated edits. Tabs support
  direct access without making users finish an ordered sequence.

## Follow-up

- [x] Update implementation docs and component inventory.
- [x] Add protocol preservation tests and update existing E2E flows.
- [ ] Complete native keyboard, Back and accessibility acceptance.
