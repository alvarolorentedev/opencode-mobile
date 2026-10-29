# Feature Coverage Map

Use this table to find the spec and the manual checks for a feature area. The
spec is the current automated contract; the manual column lists what web tests
cannot prove.

Back to the [validation index](../testing-and-validation.md) · [engineering index](../README.md).

| Feature | Automated spec | Manual / device checks |
| --- | --- | --- |
| Auto model routing | `tests/e2e/auto-model.spec.mjs`, `tests/vitest/auto-model.test.ts` | classifier/provider setup against a real server |
| Chat and transcript | `tests/e2e/chat.spec.mjs`, `tests/e2e/diffs.spec.mjs` | long transcripts, large text, screen reader |
| Conversation mode | `tests/e2e/chat.spec.mjs`, voice suites | microphone, wake word, audio session |
| Extensions | `tests/e2e/extensions.spec.mjs` | MCP OAuth completion, real plugin/skill files |
| Attachments and inbox | `tests/e2e/chat.spec.mjs` | native share sheet, document viewer, large files |
| Inbound sharing and widgets | `tests/e2e/share.spec.mjs`, `tests/e2e/app-updates.spec.mjs` | Android share intent, home widget, iOS parity gaps |
| Connections and Cloud Link | `tests/e2e/connect.spec.mjs`, `tests/e2e/manual-connection.spec.mjs` | camera, local-network reachability, real purchase |
| Multi-server | `tests/e2e/multi-server.spec.mjs` | memory pressure with several retained servers |
| Terminal | `tests/e2e/terminal.spec.mjs` | real PTY, full-screen programs, native WebSocket |
| Projects and worktrees | `tests/e2e/projects.spec.mjs` | filesystem permissions, large repositories |
| App updates | `tests/e2e/app-updates.spec.mjs` | Play-installed build, store consent |
| Onboarding and voice | `tests/e2e/onboarding.spec.mjs`, voice suites | microphone permission, downloads, enrollment |
| Settings and design | `tests/e2e/settings.spec.mjs` | screen reader, keyboard/Back, safe areas |
| Realtime and network | `tests/e2e/realtime.spec.mjs`, `tests/e2e/network-resilience.spec.mjs` | native reconnect, background/foreground |
| Protocol V1/V2 | `tests/e2e/compat.spec.mjs`, `tests/e2e/v2.spec.mjs` | provider OAuth callback, real server versions |

## Manual checks

- Physical-device checks are required for keyboard, camera, microphone, store,
  widget, notification, and screen-reader behavior.
- E2E and fake-server changes require explicit human validation under
  [AGENTS.md](../../../AGENTS.md).
- Deferred coverage lives in [known gaps](../known-gaps.md), not in historical
  validation logs.
