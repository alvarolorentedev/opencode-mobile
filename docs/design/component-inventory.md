# Component Inventory

Related: [Design system](design-system.md) · [Storybook](storybook.md) · [Design section](README.md)

This inventory is the map of current UI and support components. Use it before
adding a new control, and add a Storybook story when the component is reusable.

The inventory is split by area so a task reads only the relevant file. Start
with the table, then open the owning file.

## Inventory files

| Area | File | Covers |
| --- | --- | --- |
| Chat | [components/chat.md](components/chat.md) | Transcript, composer, cards, attachments, pending messages |
| Settings | [components/settings.md](components/settings.md) | Settings sections, connections, Cloud Link, providers, extensions |
| Screens and platform | [components/screens.md](components/screens.md) | Route controllers, widget, terminal, file browser, updates, multi-server |
| Onboarding | [components/onboarding.md](components/onboarding.md) | Onboarding steps, shared settings, provider setup |
| Shared | [components/shared.md](components/shared.md) | Reusable controls, provider/utility contracts, cross-cutting presentation |

## How to use this inventory

This document inventories the current UI and support components, their responsibilities, and their prop contracts where relevant to parity.

The goal is to make it possible to rebuild the UI tree without having to rediscover each component's role from source. Start here when deciding whether a new component is needed; extend an existing component or shared control before adding a parallel one.
