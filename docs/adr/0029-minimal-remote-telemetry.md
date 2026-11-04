# ADR 0029: Minimal remote telemetry budget

- Status: Accepted
- Date: 2026-11-04
- Deciders: maintainers
- Supersedes: —
- Related: [ADR 0020](0020-local-first-observability-and-otlp.md), [observability](../architecture/observability.md)

## Context

The broad instrumentation added with ADR 0020 emitted sampled spans, request and
latency metrics, and handled-error logs. That volume exhausted the Grafana Cloud
metrics and traces capacity, while most of the data duplicated local diagnostics
that are already available on-device.

Remote telemetry still needs a small product signal: how many servers use the V1
and V2 OpenCode protocols.

## Decision

Keep the local-first diagnostics pipeline, but limit remote export to:

- unhandled exceptions, fatal JavaScript errors, and unhandled rejections as OTLP
  logs under Crash reports;
- one counter, `server.contract`, with a bounded `v1`/`v2` label, recorded once
  per server per launch under Usage diagnostics.

Do not emit remote spans. Remove HTTP request traces and request/retry metrics.
Handled domain failures, including voice capture failures, stay in the local
JSONL store and are never uploaded. Adding a metric or span requires an explicit
product request and an update to the observability documentation.

## Consequences

- Grafana volume is bounded by crashes plus one low-cardinality counter.
- Connection, SSE, polling, transcript, notification and tool timings remain
  available locally through Recent activity and diagnostic exports.
- Performance regressions are no longer visible remotely; reproduce them from a
  local export when needed.
- The OpenTelemetry trace and metric SDKs stay in place so a future approved
  signal does not need a new backend integration.

## Alternatives considered

- **Keep sampled traces and rely on retention:** rejected because sampling still
  exhausted the provisioned traces capacity.
- **Keep only error spans:** rejected because the same unhandled errors already
  arrive as crash logs, so error spans duplicated volume.
- **Drop the remote metric path entirely:** rejected because the V1/V2 server
  distribution is the one signal currently requested.

## Follow-up

- [x] Update the observability and settings documentation.
- [x] Remove HTTP spans, request metrics, and handled-error uploads.
- [x] Add the bounded `server.contract` counter.
- [ ] Revisit this budget only when a new signal is explicitly requested.
