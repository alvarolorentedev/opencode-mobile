# Testing And Validation

This page is the index for the current validation contract. Start with the
change type, then open the owning file.

Back to the [engineering index](README.md) · [documentation hub](../README.md).

| I need to… | Read |
| --- | --- |
| Validate before creating or amending a commit | [strategy.md](validation/strategy.md#local-commit-gate) |
| Choose a validation command | [strategy.md](validation/strategy.md) |
| Understand CI gates and costs | [strategy.md](validation/strategy.md#ci-gates) |
| Change the fake server or a scenario | [fake-server.md](validation/fake-server.md) |
| Add or change an E2E flow | [e2e.md](validation/e2e.md) |
| Verify real OpenCode 2 plugin commands | [server-plugins.md](validation/server-plugins.md) |
| Find the spec for a feature | [regressions.md](validation/regressions.md) |
| Run focused checks and inspect CI | [strategy.md](validation/strategy.md#start-here) and [testing overview](testing-overview.md) |
| Change logs, traces, metrics, diagnostics or remote telemetry | [observability](../architecture/observability.md) and `shared/observability/__tests__/` |

Historical per-feature validation narratives were removed. The current contract
is the E2E spec plus the owning architecture, product, or design doc. Deferred
coverage is tracked in [known gaps](known-gaps.md).

## Files

| File | Owns |
| --- | --- |
| [strategy.md](validation/strategy.md) | Validation principles, costs, CI gates, coverage gaps, commands, suite map |
| [fake-server.md](validation/fake-server.md) | Fake server files, scenarios, and scenario-adding workflow |
| [e2e.md](validation/e2e.md) | Playwright spec map and supported flow coverage |
| [regressions.md](validation/regressions.md) | Feature-to-spec map and manual/device checks |
