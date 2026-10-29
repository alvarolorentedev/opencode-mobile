# Product

Back to the [documentation hub](../README.md).

What the app does for users, feature by feature.

This section is the source of truth for user-visible behavior. Use it when
adding a flow, changing copy, changing permissions or confirmation behavior, or
checking whether a platform-specific gap is intentional.

## Documents

| Document | Owns |
| --- | --- |
| [functional-spec.md](functional-spec.md) | End-to-end user journeys, screen behavior, composer/transcript rules, settings behavior, and parity requirements |
| [auto-model-routing.md](auto-model-routing.md) | Automatic model selection, classifier options, guards, persistence, and privacy |
| [cloud-link.md](cloud-link.md) | Cloud Link setup, local V2 pairing, subscription/purchase flow, machines, and transport |
| [app-updates.md](app-updates.md) | Android in-app updates, iOS prerequisites, and update acceptance |
| [parity/ios-share.md](parity/ios-share.md) | Deferred iOS inbound-share parity requirements |
| [parity/ios-widget.md](parity/ios-widget.md) | Deferred iOS widget and Live Activity parity requirements |

## Feature ownership

| Area | Primary implementation |
| --- | --- |
| Chat, sessions, prompts, approvals | `providers/` + `components/chat/` |
| Projects, worktrees, files | `providers/` + `components/project/` + `app/(tabs)/projects.tsx` |
| Settings, providers, extensions, voice | `providers/` + `components/settings/` |
| Terminal | `providers/use-terminal-state.ts` + `components/terminal/` |
| Cloud Link | `providers/connect/` + `components/settings/` |
| Notifications, widgets, quick actions | `lib/` + `providers/` |
| Inbound sharing | `providers/use-share-state.ts` + `lib/share/` + `app/share.tsx` |

## Rules

- Behavior changes update [functional-spec.md](functional-spec.md) in the same
  change.
- Every new or changed user-facing string must exist in every supported locale.
  See the [design system](../design/design-system.md) and `lib/i18n/`.
- A platform gap is intentional only when it is documented in this section or
  in [known gaps](../engineering/known-gaps.md).
- Product decisions that constrain architecture or protocol belong in an
  [ADR](../adr/README.md), not only in this section.

## Related

- [Design system](../design/design-system.md) for presentation and accessibility
- [Testing and validation](../engineering/testing-and-validation.md) for flow coverage
- [API contract](../architecture/api-contract.md) for server capabilities
