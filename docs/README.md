# OpenCode Mobile Documentation

This folder documents the current implementation of `opencode-mobile` as it exists in the codebase today.

The goal is not aspirational design documentation. It is an implementation reference for:

- understanding the current modularization and runtime architecture
- preserving feature parity if the app is reimplemented
- making maintenance work safer by documenting hidden coupling and operational assumptions

## Document Index

- `design-system.md`
  Shared visual foundations, settings components, interaction states, accessibility,
  search destinations, and the checklist for future features.

- `architecture.md`
  Architecture, module boundaries, runtime boot flow, and state ownership.
- `functional-spec.md`
  User-visible behavior and feature parity requirements by screen and workflow.
- `state-and-data.md`
  Provider state model, persistence, derived data, and OpenCode protocol mapping.
- `network-resilience.md`
  Connectivity, request deadlines, SSE/polling recovery, offline queue, and
  slow-network cache behavior.
- `integrations-and-operations.md`
  External dependencies, Expo/native integrations, environment configuration, and operational notes.
- `testing-and-validation.md`
  Current validation strategy, fake server behavior, and test coverage boundaries.
- `api-contract.md`
  Endpoint-by-endpoint client contract with example request and response shapes.
- `component-inventory.md`
  UI and support component inventory with responsibilities and prop contracts.
- `ios-share-parity.md`
  Deferred iOS inbound-share gap and the requirements to close it.
- `ios-widget-parity.md`
  Deferred iOS widget/Live Activity gap, shipped quick actions and the Android
  home widget, and the requirements to close the iOS side.
- `known-gaps.md`
  Remaining deliberately deferred work: the untyped Vitest denylist, the
  standalone FOSS prepare script, remote crash reporting, and render-timing
  coupling in workspace readiness. Earlier orchestration, test-split,
  CI-duplication, and local-diagnostics gaps were closed on 2026-10-18.
- `library-extraction.md`
  Library replacements, deferred native/UI evaluations, and candidate
  standalone packages with their boundaries and risks.
- `development.md` explanation on how to run the app locally.

## Current System Summary

OpenCode Mobile is an Expo / React Native client for an OpenCode server. The app is intentionally thin at the screen level and thick in one shared composition unit: `providers/use-opencode-provider-composition.ts` (mounted by `providers/opencode-provider.tsx`).

Most important behavior flows through this provider:

- server connection and project discovery
- session lifecycle
- prompt submission
- transcript, diff, and todo refresh
- session-scoped permission and question handling with event and list reconciliation
- session lifecycle/archive, slash commands, project editing/worktrees, MCP, PTYs, and diagnostics
- provider/model/agent capability discovery
- local persistence
- conversation mode orchestration
- notification tracking

The tabs mostly render and manipulate provider state:

- `Chat`: active session UI
- `Project`: project and session selection
- `Settings`: connection, provider, MCP, notification, and voice configuration
- `Terminal`: interactive project PTYs with xterm and terminal-key accessory

## Recommended Reading Order

1. `architecture.md`
2. `functional-spec.md`
3. `state-and-data.md`
4. `network-resilience.md`
5. `integrations-and-operations.md`
6. `testing-and-validation.md`
7. `api-contract.md`
8. `component-inventory.md`
9. `library-extraction.md`

## Scope Notes

- This documentation focuses on the mobile app implementation, not the full OpenCode server internals.
- Descriptions are based on the current source code and test fixtures in this repository.
- Where behavior is platform-dependent, the current implementation is described exactly, including limitations.
