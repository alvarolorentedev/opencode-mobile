# Engineering

Back to the [documentation hub](../README.md).

Local setup, validation, operations, release, and deferred engineering work.

Use this section when you need to run the app, change the test contract, ship a
build, or understand an operational constraint.

## Documents

| Document | Owns |
| --- | --- |
| [development.md](development.md) | Requirements, setup, common commands, native builds, configuration, and store update setup |
| [testing-overview.md](testing-overview.md) | Short testing strategy and merge-gate overview |
| [testing-and-validation.md](testing-and-validation.md) | Authoritative test strategy, fake-server scenarios, E2E coverage, fast paths, and validation costs |
| [integrations-and-operations.md](integrations-and-operations.md) | External dependencies, Expo/native integrations, environment rules, operational scripts, and release notes |
| [voice-validation.md](voice-validation.md) | Offline wake-word benchmark and physical-device voice checklist |
| [library-extraction.md](library-extraction.md) | Library replacements, deferred evaluations, and candidate extraction boundaries |
| [fdroid.md](fdroid.md) | F-Droid/FOSS variant scope, build, and distribution |
| [known-gaps.md](known-gaps.md) | Deliberately deferred engineering work and its constraints |

## Common entry points

| Task | Start |
| --- | --- |
| Install and run locally | [development.md](development.md) |
| Run the pre-push gate | [development.md](development.md) and [testing-and-validation.md](testing-and-validation.md) |
| Change a fake-server scenario | [testing-and-validation.md](testing-and-validation.md) and `tests/fake-opencode/` |
| Change E2E behavior | [testing-and-validation.md](testing-and-validation.md) and `tests/e2e/` |
| Ship Android/iOS | [development.md](development.md) + [integrations-and-operations.md](integrations-and-operations.md) |
| Ship F-Droid | [fdroid.md](fdroid.md) |
| Diagnose offline/slow-network behavior | [network resilience](../architecture/network-resilience.md) |
| Add or replace a dependency | [library-extraction.md](library-extraction.md) |

## Rules

- Do not duplicate the command list across docs. `package.json` is the source
  of truth; this section explains when and why to run a command.
- Changes under `tests/e2e/` or `tests/fake-opencode/` require explicit human
  validation, even when automated checks pass.
- A behavior or contract change updates the matching architecture/product doc
  and, when it selects an approach, an [ADR](../adr/README.md).
- Keep deferred work in [known-gaps.md](known-gaps.md) rather than scattered
  TODO comments.
