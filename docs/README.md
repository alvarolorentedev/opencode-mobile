# OpenCode Mobile Documentation

This folder documents the current implementation of `opencode-mobile` as it exists in the codebase today.

The goal is not aspirational design documentation. It is an implementation reference for:

- understanding the current modularization and runtime architecture
- preserving feature parity if the app is reimplemented
- making maintenance work safer by documenting hidden coupling and operational assumptions

## Document Index

- `architecture.md`
  Architecture, module boundaries, runtime boot flow, and state ownership.
- `functional-spec.md`
  User-visible behavior and feature parity requirements by screen and workflow.
- `state-and-data.md`
  Provider state model, persistence, derived data, and OpenCode protocol mapping.
- `integrations-and-operations.md`
  External dependencies, Expo/native integrations, environment configuration, and operational notes.
- `testing-and-validation.md`
  Current validation strategy, fake server behavior, and test coverage boundaries.
- `regeneration-blueprint.md`
  Rebuild-oriented contract: UI inventory, event expectations, server shape summary, and parity traps.
- `api-contract.md`
  Endpoint-by-endpoint client contract with example request and response shapes.
- `component-inventory.md`
  UI and support component inventory with responsibilities and prop contracts.
- `rebuild-checklist.md`
  Step-by-step execution checklist for regenerating the app with parity.

## Current System Summary

OpenCode Mobile is an Expo / React Native client for an OpenCode server. The app is intentionally thin at the screen level and thick in one shared state container: `providers/opencode-provider.tsx`.

Most important behavior flows through this provider:

- server connection and workspace discovery
- session lifecycle
- prompt submission
- transcript, diff, and todo refresh
- permission and question handling
- provider/model/agent capability discovery
- local persistence
- conversation mode orchestration
- notification tracking

The tabs mostly render and manipulate provider state:

- `Chat`: active session UI
- `Workspace`: project and session selection
- `Settings`: connection, provider, notification, and voice configuration

## Recommended Reading Order

1. `architecture.md`
2. `functional-spec.md`
3. `state-and-data.md`
4. `integrations-and-operations.md`
5. `testing-and-validation.md`
6. `regeneration-blueprint.md`
7. `api-contract.md`
8. `component-inventory.md`
9. `rebuild-checklist.md`

## Scope Notes

- This documentation focuses on the mobile app implementation, not the full OpenCode server internals.
- Descriptions are based on the current source code and test fixtures in this repository.
- Where behavior is platform-dependent, the current implementation is described exactly, including limitations.
