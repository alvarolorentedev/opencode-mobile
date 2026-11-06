# Architecture Decision Records

ADRs capture decisions that are expensive to reverse or that shape how future
changes are made. They explain **why** the code is the way it is. The rest of
`docs/` explains **what** the code does.

## When to write an ADR

Write one when a change:

- selects a framework, transport, storage model, or protocol boundary
- changes ownership between `app/`, `components/`, `providers/`, `lib/`, or
  `providers/services/`
- adds or removes a compatibility path or a supported platform
- establishes a design-system primitive, token family, or accessibility policy
- rejects a viable alternative for a reason future maintainers need to know
- changes the documentation or decision workflow itself

Do not write an ADR for a routine bug fix, a local refactor that preserves
boundaries, or a copy change. If you are unsure, ask whether a future
maintainer would otherwise re-litigate the choice.

## Workflow

1. Copy [template.md](template.md) to
   `docs/adr/NNNN-short-kebab-title.md`, using the next four-digit number.
2. Fill in context, decision, consequences, and alternatives. Keep it short and
   concrete; link to code and docs instead of duplicating them.
3. Add the ADR to the index below in the same change.
4. Link the ADR from the affected implementation doc and mention it in the
   change summary.
5. If a later decision replaces it, set the old status to `Superseded by ADR
   NNNN` and add the new ADR. Do not rewrite history.

`tests/vitest/docs.test.ts` checks ADR numbering, required sections, index
coverage, and documentation links.

## Status values

| Status | Meaning |
| --- | --- |
| `Proposed` | Under discussion; not yet binding |
| `Accepted` | Current decision |
| `Superseded by ADR NNNN` | Replaced; kept for history |
| `Deprecated` | No longer recommended, but not directly replaced |
| `Rejected` | Considered and declined |

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions as ADRs | Accepted |
| [0002](0002-provider-centric-orchestration.md) | Provider-centric domain orchestration | Superseded by ADR 0015 |
| [0003](0003-v2-first-protocol-boundary.md) | V2-first protocol boundary with isolated V1 compatibility | Accepted |
| [0004](0004-sse-with-polling-fallback.md) | SSE primary with polling fallback | Accepted |
| [0005](0005-thin-routes-and-presentational-components.md) | Thin routes and presentational components | Superseded by ADR 0015 |
| [0006](0006-semantic-design-tokens-and-paper.md) | Semantic design tokens with React Native Paper | Superseded by ADR 0013 |
| [0007](0007-storybook-component-catalog.md) | Storybook for reusable components | Superseded by ADR 0013 |
| [0008](0008-documentation-information-architecture.md) | Documentation information architecture and checks | Accepted |
| [0009](0009-agent-first-documentation-routing.md) | Agent-first documentation routing and drift checks | Accepted |
| [0010](0010-risk-based-validation-and-selective-pr-e2e.md) | Risk-based validation and selective PR E2E | Superseded by ADR 0011 |
| [0011](0011-release-from-green-main-builds.md) | Release from green main builds, not tag pushes | Superseded by ADR 0018 |
| [0012](0012-shell-mediated-project-file-actions.md) | Shell-mediated project file actions | Accepted |
| [0013](0013-source-owned-ui-and-complex-forms.md) | Source-owned Reusables, Uniwind tokens and complex forms | Accepted |
| [0014](0014-server-data-and-explicit-lifecycles.md) | Scoped server data and explicit application lifecycles | Accepted |

| [0015](0015-feature-oriented-implementation.md) | Feature ownership with shared runtime composition | Accepted |

| [0016](0016-supported-expo-native-integrations.md) | Supported Expo native integrations and agent tooling | Superseded by ADR 0017 |
| [0017](0017-native-defaults-and-prebuilt-engines.md) | Upstream update defaults and pinned prebuilt engines | Superseded by ADR 0031 |
| [0018](0018-tag-driven-release-pipeline.md) | Tag-driven release pipeline with static artifact verification | Accepted |
| [0019](0019-arm64-only-android-releases.md) | ARM64-only Android release artifacts | Accepted |
| [0020](0020-local-first-observability-and-otlp.md) | Local-first observability with opt-in OTLP export | Accepted |
| [0021](0021-per-connection-custom-ca.md) | Per-connection custom CA trust | Accepted |
| [0022](0022-markdown-first-extension-definitions.md) | Markdown-first agent and command definitions with JSONC compatibility | Accepted |
| [0023](0023-focused-extension-editors.md) | Focused extension editors with structured authoring | Accepted |

| [0024](0024-oidc-pkce-connection-authorization.md) | Secure OpenID Connect authorization for connections | Accepted |
| [0025](0025-server-exposed-plugin-commands.md) | Server-exposed plugin commands and authoritative execution | Accepted |
| [0026](0026-metadata-driven-agent-selection.md) | Metadata-driven agent selection | Accepted |
| [0027](0027-sandboxed-mobile-plugin-gui-host.md) | Sandboxed mobile host for OpenCode GUI plugins | Accepted |
| [0028](0028-runtime-rtl-from-interface-language.md) | Runtime RTL direction follows the interface language | Accepted |
| [0029](0029-minimal-remote-telemetry.md) | Minimal remote telemetry budget | Accepted |
| [0030](0030-server-archived-projects.md) | Server-archived project visibility without a client archive write | Accepted |
| [0031](0031-flexible-updates-with-explicit-install.md) | Flexible store updates with explicit install | Superseded by ADR 0036 |
| [0032](0032-web-parity-project-picker.md) | Project picker matches web Used/Other semantics | Superseded by ADR 0033 |
| [0033](0033-server-driven-projects-and-sessions.md) | Server-driven projects and sessions without local registries | Accepted |
| [0034](0034-device-local-project-archive.md) | Device-local project archive marker | Superseded by ADR 0038 |
| [0035](0035-live-token-highlighting-in-the-composer.md) | Live token highlighting in the composer | Accepted |
| [0036](0036-flexible-first-with-play-urgency.md) | Flexible-first store updates with a Play urgency override | Accepted |
| [0037](0037-per-agent-model-memory.md) | Per-agent model memory and explicit auto-model thinking levels | Accepted |
| [0038](0038-single-archived-projects-switch.md) | One archived-projects switch in the project picker | Accepted |

## Template

Use [template.md](template.md). Keep the front matter fields (`Status`, `Date`,
`Deciders`, `Supersedes`, `Related`) so the index and checks stay useful.

## Related

- [Documentation router](../README.md)
- [Architecture](../architecture/README.md)
- [Design](../design/README.md)
- [Engineering](../engineering/README.md)
