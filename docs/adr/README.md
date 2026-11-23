# Architecture Decision Records

ADRs capture decisions that are expensive to reverse or that shape how future
changes are made. They explain **why**. The rest of `docs/` explains **what**.

## When to write an ADR

Write one when a change:

- selects a framework, transport, storage model or protocol boundary
- changes ownership between `app/`, `features/`, `runtime/`, `shared/` or
  `modules/`
- adds or removes a compatibility path or a supported platform
- establishes a design-system primitive, token family or accessibility policy
- rejects a viable alternative for a reason future maintainers need
- changes the documentation or decision workflow

Do not write an ADR for a routine bug fix, a boundary-preserving refactor or a
copy change. Ask whether a future maintainer would otherwise re-litigate it.

## Workflow

1. Copy [template.md](template.md) to
   `docs/adr/NNNN-short-kebab-title.md`, using the next four-digit number.
2. Fill in context, decision, consequences and alternatives. Keep it short;
   link to code and docs instead of duplicating them.
3. Add the ADR to the index below in the same change.
4. Link the ADR from the affected implementation doc.
5. If a later decision replaces it, set the old status to
   `Superseded by ADR NNNN` and add the new ADR. Do not rewrite history.

`tests/vitest/docs.test.ts` checks ADR numbering, required sections, index
coverage and documentation links.

## Status values

| Status | Meaning |
| --- | --- |
| `Proposed` | Under discussion; not yet binding |
| `Accepted` | Current decision |
| `Superseded by ADR NNNN` | Replaced; kept for history |
| `Deprecated` | No longer recommended, but not directly replaced |
| `Rejected` | Considered and declined |

## Current decisions

All current decisions are `Accepted`.

| ADR | Decision |
| --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions as ADRs |
| [0003](0003-v2-first-protocol-boundary.md) | V2-first protocol boundary with isolated V1 compatibility |
| [0004](0004-sse-with-polling-fallback.md) | SSE primary with polling fallback |
| [0008](0008-documentation-information-architecture.md) | Documentation information architecture and checks |
| [0009](0009-agent-first-documentation-routing.md) | Agent-first documentation routing and drift checks |
| [0012](0012-shell-mediated-project-file-actions.md) | Shell-mediated project file actions |
| [0013](0013-source-owned-ui-and-complex-forms.md) | Source-owned Reusables, Uniwind tokens and complex forms |
| [0014](0014-server-data-and-explicit-lifecycles.md) | Scoped server data and explicit application lifecycles |
| [0018](0018-tag-driven-release-pipeline.md) | Tag-driven release pipeline with static artifact verification |
| [0019](0019-arm64-only-android-releases.md) | ARM64-only Android release artifacts |
| [0020](0020-local-first-observability-and-otlp.md) | Local-first observability with opt-in OTLP export |
| [0021](0021-per-connection-custom-ca.md) | Per-connection custom CA trust |
| [0022](0022-markdown-first-extension-definitions.md) | Markdown-first agent and command definitions with JSONC compatibility |
| [0023](0023-focused-extension-editors.md) | Focused extension editors with structured authoring |
| [0024](0024-oidc-pkce-connection-authorization.md) | Secure OpenID Connect authorization for connections |
| [0025](0025-server-exposed-plugin-commands.md) | Server-exposed plugin commands and authoritative execution |
| [0026](0026-metadata-driven-agent-selection.md) | Metadata-driven agent selection |
| [0027](0027-sandboxed-mobile-plugin-gui-host.md) | Sandboxed mobile host for OpenCode GUI plugins |
| [0028](0028-runtime-rtl-from-interface-language.md) | Runtime RTL direction follows the interface language |
| [0029](0029-minimal-remote-telemetry.md) | Minimal remote telemetry budget |
| [0030](0030-server-archived-projects.md) | Server-archived project visibility without a client archive write |
| [0033](0033-server-driven-projects-and-sessions.md) | Server-driven projects and sessions without local registries |
| [0035](0035-live-token-highlighting-in-the-composer.md) | Live token highlighting in the composer |
| [0036](0036-flexible-first-with-play-urgency.md) | Flexible-first store updates with a Play urgency override |
| [0038](0038-single-archived-projects-switch.md) | One archived-projects switch in the project picker |
| [0039](0039-plugin-command-reports-as-notices.md) | Plugin command reports render as distinct notices |
| [0040](0040-connection-owned-mission-control.md) | Connection-owned Mission Control activity |
| [0041](0041-connector-enforced-service-access.md) | Connector-enforced exposed-service access |
| [0042](0042-mission-server-aggregates.md) | Server aggregates for Mission Control history |
| [0043](0043-react-native-chart-kit.md) | ChartKit for the Mission Control usage chart |
| [0044](0044-shared-session-links.md) | Shared OpenCode session links |
| [0045](0045-queue-only-unsent-prompts.md) | Queue only unsent prompts |
| [0048](0048-system-and-local-wake-detection.md) | Retain System and On-device wake detection |
| [0049](0049-bounded-mission-stats-snapshots.md) | Bounded Mission Control statistics snapshots |
| [0050](0050-live-v2-transcript-with-reconciliation.md) | Live V2 transcript with boundary reconciliation |
| [0051](0051-app-core-state-tiers.md) | App core with Query for server facts and Zustand for device facts |
| [0052](0052-explicit-overlay-dependencies.md) | Feature ownership and explicit overlay dependencies |
| [0053](0053-cloud-link-device-credential-renewal.md) | Cloud Link device-credential renewal and session step-up |
| [0054](0054-session-chat-configuration-inheritance.md) | Session chat configuration inheritance |

## Superseded history

Kept for history; the newest record in each chain wins. Read only when tracing a
past decision: [0002](0002-provider-centric-orchestration.md),
[0005](0005-thin-routes-and-presentational-components.md),
[0006](0006-semantic-design-tokens-and-paper.md),
[0007](0007-storybook-component-catalog.md),
[0010](0010-risk-based-validation-and-selective-pr-e2e.md),
[0011](0011-release-from-green-main-builds.md),
[0015](0015-feature-oriented-implementation.md),
[0016](0016-supported-expo-native-integrations.md),
[0017](0017-native-defaults-and-prebuilt-engines.md),
[0031](0031-flexible-updates-with-explicit-install.md),
[0032](0032-web-parity-project-picker.md),
[0034](0034-device-local-project-archive.md),
[0037](0037-per-agent-model-memory.md),
[0046](0046-session-owned-model-selection.md),
[0047](0047-new-session-last-used-model.md).
