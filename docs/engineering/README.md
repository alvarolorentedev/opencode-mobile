# Engineering

Back to the [documentation hub](../README.md).

Local setup, validation, operations, release, and deferred engineering work.

Use this section when you need to run the app, change the test contract, ship a
build, or understand an operational constraint.

## Documents

| Document | Owns |
| --- | --- |
| [development.md](development.md) | Requirements, setup, common commands, native builds, configuration, and store update setup |
| [task-recipes.md](task-recipes.md) | Step-by-step checklists for translations, settings, fake-server/E2E, and provider state |
| [testing-overview.md](testing-overview.md) | Short testing strategy and merge-gate overview |
| [testing-and-validation.md](testing-and-validation.md) | Validation index: choose a command, fake server, E2E, or feature coverage |
| [validation/strategy.md](validation/strategy.md) | Validation principles, costs, CI gates, coverage gaps, commands, and suite map |
| [validation/fake-server.md](validation/fake-server.md) | Fake server files, scenarios, and scenario-adding workflow |
| [validation/e2e.md](validation/e2e.md) | Playwright spec map and supported flow coverage |
| [validation/regressions.md](validation/regressions.md) | Feature-to-spec map and manual/device checks |
| [integrations-and-operations.md](integrations-and-operations.md) | External dependencies, Expo/native integrations, environment rules, operational scripts, and release notes |
| [voice-validation.md](voice-validation.md) | Offline wake-word benchmark and physical-device voice checklist |
| [library-extraction.md](library-extraction.md) | Library replacements, deferred evaluations, and candidate extraction boundaries |
| [fdroid.md](fdroid.md) | F-Droid/FOSS variant scope, build, and distribution |
| [known-gaps.md](known-gaps.md) | Deliberately deferred engineering work and its constraints |

## Common entry points

| Task | Start |
| --- | --- |
| Install and run locally | [development.md](development.md) |
| Follow a task checklist | [task-recipes.md](task-recipes.md) |
| Run the pre-push gate | [development.md](development.md) and [validation/strategy.md](validation/strategy.md) |
| Change a fake-server scenario | [validation/fake-server.md](validation/fake-server.md) and `tests/fake-opencode/` |
| Change E2E behavior | [validation/e2e.md](validation/e2e.md) and `tests/e2e/` |
| Ship Android/iOS | [development.md](development.md) + [integrations-and-operations.md](integrations-and-operations.md) |
| Ship F-Droid | [fdroid.md](fdroid.md) |
| Diagnose offline/slow-network behavior | [network resilience](../architecture/network-resilience.md) |
| Add or replace a dependency | [library-extraction.md](library-extraction.md) |

## Rules

- Do not duplicate the full command list across docs. `package.json` is the
  source of truth; task checklists name only the commands they need.
- Changes under `tests/e2e/` or `tests/fake-opencode/` require explicit human
  validation, even when automated checks pass.
- A behavior or contract change updates the matching architecture/product doc
  and, when it selects an approach, an [ADR](../adr/README.md).
- Keep deferred work in [known-gaps.md](known-gaps.md) rather than scattered
  TODO comments.
