# Observability and Diagnostics

Related: [ADR 0020](../adr/0020-local-first-observability-and-otlp.md) · [ADR 0029](../adr/0029-minimal-remote-telemetry.md) · [Network resilience](network-resilience.md) · [F-Droid](../engineering/fdroid.md)

OpenCode Mobile records diagnostics locally by default and treats remote
telemetry as an explicit, category-scoped opt-in. The instrumentation API is
provider-independent: features import `shared/observability/client`, never a
vendor SDK.

## Data flow

```text
application instrumentation
  -> allowlist + text/stack sanitizer
  -> structured logs / spans / metrics
  -> bounded JSONL store (local, retained 7 days or 10 MB)
  -> optional OTLP/HTTP exporter (Grafana Cloud or any OTLP backend)
```

`shared/observability/` owns the contracts, sanitizer, local store and export report.
The OpenTelemetry JS SDK owns span/trace lifecycle, metric aggregation, batching,
OTLP serialization, retries and resource attributes; small exporters adapt the
SDK output to the local JSONL store and to Grafana Cloud's OTLP gateway. `shared/platform/error-reporting.ts`
keeps the synchronous fatal-error file and copies it into the local stream once
on the next launch. `features/connections/ui/settings/` presents the controls;
it does not own a second diagnostics store.

## Public instrumentation

Use the lightweight client from application code:

```ts
import { telemetry } from '@/shared/observability/client';

telemetry.info('workspace.opened', { kind: 'refresh' });
telemetry.counter('server.contract', 1, { contract: 'v2' });
```

The client is a no-op until `initializeObservability()` mounts the application
instance. That keeps protocol tests and background workers free of native
filesystem dependencies. The application singleton is
`shared/observability/index.ts`; do not create another instance in a feature.

Stable rules:

- Log names and metric names are lowercase dotted identifiers.
- Attributes are structured metadata only; unknown keys are dropped.
- Never pass prompts, responses, transcripts, source, diffs, file contents,
  terminal output, URLs, credentials, headers, paths, tokens or user input.
- Metric labels must be bounded enums or short safe values. Never use project,
  session, request or server identifiers as labels.
- The only remote metric is `server.contract` with a `v1`/`v2` label, recorded
  once per server per launch. Do not add metrics or spans without an explicit
  product request.
- Trace/span IDs are random per operation; the session ID is random per launch.
  They are correlation aids, not installation identifiers.

## Local recording

- Enabled by default; persisted with the existing global preferences.
- Storage: `Paths.document/opencode-diagnostics/segment-<epoch>-<seq>.jsonl`.
- Each line is a versioned record (`v: 1`) with timestamp, kind, level/name,
  sanitized metadata and optional trace correlation.
- Buffered writes (500 records / 256 KB, 2 s flush); fatal errors use the
  existing synchronous last-error file.
- Retention: 7 days or 10 MB total, whichever comes first. Segments rotate at
  512 KB.
- Corrupt lines/files are skipped. Startup and business logic never depend on
  diagnostics writes succeeding.
- Normal level records `info+`; verbose records `debug+`. Errors are always
  recorded.
- Settings can inspect recent events, storage usage, failures and metrics;
  clear history; and export a report. Recent activity flushes pending local
  writes on refresh and lists both ordinary logs and captured errors.

## Remote telemetry

Remote export is optional and disabled when no OTLP credentials are configured
or in FOSS builds. The master switch and the crash/usage categories are stored
with the existing preferences. Defaults are enabled; a build without a backend
still makes no network requests because no exporter is constructed.

The exporter is a generic OTLP/HTTP exporter:

- Crash consent sends only unhandled exceptions and fatal JavaScript errors
  reported through `captureError` as OTLP logs. Handled domain failures, HTTP
  request failures and named logs such as `telemetry.error()` stay local. The
  log queue checks both the master switch and Crash reports when accepting and
  exporting records. Turning either off retires the current log batch, including
  when Usage stays enabled. Re-enabling starts a fresh batch.
- Usage consent sends only the `server.contract` metric (`v1`/`v2`, recorded
  once per server per launch) as OTLP metrics. No spans are emitted; HTTP request
  traces were removed to stay within the Grafana metrics and traces budget.
- Routine logs are never sent remotely.
- OTel batch processors use memory-only bounded queues (100 records, batches of
  20, 30 s interval). The SDK owns retry/backoff; queues are shut down and
  discarded immediately when consent is revoked.
- Enabling consent never reads or uploads previously stored local files.
- gzip is used for larger payloads; no session replay, screenshots, interaction
  recording, breadcrumbs or request/response bodies exist.

### Grafana Cloud setup

1. In Grafana Cloud, open the stack's **OpenTelemetry** tile and copy the OTLP
   gateway URL, instance ID and a write-scoped access token.
2. Build with:

```bash
EXPO_PUBLIC_GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp \
EXPO_PUBLIC_GRAFANA_OTLP_INSTANCE_ID=<instance-id> \
EXPO_PUBLIC_GRAFANA_OTLP_TOKEN=<write-only-token> \
EXPO_PUBLIC_OBSERVABILITY_ENVIRONMENT=production \
npx expo ... # start or build
```

The endpoint must be HTTPS (plain HTTP is accepted only for localhost
development). The exporter appends `/v1/traces`, `/v1/logs` and `/v1/metrics`.
GitHub releases read `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_OTLP_INSTANCE_ID`,
`OBSERVABILITY_ENVIRONMENT` repository variables and the `GRAFANA_OTLP_TOKEN`
secret, then map them to these public names only for Android/iOS builds. See
[integration operations](../engineering/integrations-and-operations.md).
The token must be write-only (`traces:write`, `logs:write`, `metrics:write`) and
rotated on a schedule. `EXPO_PUBLIC_*` values are bundled into the app and can be
extracted; never use a read token or a personal Grafana credential.

No Grafana Cloud account, DSN, sponsorship or backend server is required for
local diagnostics. Other OTLP-compatible backends can use the same adapter.

### Voice capture diagnostics

In Settings → Diagnostics, open **Recent activity** or export a report with
details. Voice records use the operations `voice.recognition` and
`voice.enrollment`. The fields identify the source (dictation, conversation, or
enrollment), capture phase, reason, and outcome. When available, they also carry
the attempt number, recognizer mode, a numeric recognizer status or known
recorder error code, and elapsed
milliseconds. Background cancellations and recognition ownership conflicts are
recorded so a silent start failure is visible. Retry, cancellation, and expected
input errors stay local.
Unexpected terminal failures appear in `errors.jsonl` as local-only records;
they are never uploaded. Voice diagnostics contain no audio, recognized text,
embeddings, device identifiers, or native exception messages.

To inspect a terminal voice failure, open Settings → Diagnostics → Recent
activity or export a report. The failure appears in `errors.jsonl` and recent
activity. It is not expected in Grafana because handled voice failures stay
local; only unhandled and fatal errors are uploaded.

### Source maps and native crashes

The OTLP path does not symbolicate Hermes/JavaScript stacks. Local exports retain
sanitized stack traces for GitHub issues. Native hard crashes and ANRs are not
captured because this implementation deliberately avoids a native telemetry SDK;
that remains a documented gap until a consent-safe native adapter is validated.

## Export

Settings → Diagnostics → **Export report** creates a ZIP in the app cache and
opens the system share sheet. It never uploads automatically. Contents:

- `manifest.json`: schema version, timestamp, app/build/OS metadata, retention
  and consent summary, event counts and the privacy policy version.
- `logs.jsonl`, `spans.jsonl`, `metrics.jsonl`, `errors.jsonl` when detailed
  events are included.
- `README.txt`.

All records are sanitized again while assembling the archive. Temporary exports
are pruned after sharing and on later exports.

## FOSS and build constraints

The OpenTelemetry JS packages and `fflate` are pure JavaScript and remain in the FOSS
build. Remote export is intentionally unavailable in the FOSS variant, so the
F-Droid artifact has no hosted observability dependency and no proprietary
native SDK. Local diagnostics, inspection, clearing and export remain available.
See [F-Droid](../engineering/fdroid.md).

## Library boundaries

- `@opentelemetry/sdk-trace` owns tracers, samplers, span processors and
  batch export.
- `@opentelemetry/sdk-metrics` owns counters, gauges, histograms, cardinality
  limits and periodic metric readers.
- `@opentelemetry/sdk-logs` owns log records and batch log processors.
- `@opentelemetry/exporter-*-otlp-http` owns OTLP/HTTP serialization and network
  retry behavior. No hand-written OTLP encoder or retry loop exists.
- `fflate` owns ZIP and gzip compression.
- Local JSONL retention/rotation, privacy scrubbing, consent, settings and the
  export manifest remain app-specific because they encode product/privacy rules.

## Adding instrumentation

1. Prefer an existing owning hook or service; do not add a parallel counter.
2. Do not add metrics or spans by default. Add one only when the product
   explicitly asks for a bounded signal, and keep labels to short enums.
3. Use logs for local state changes and failures; routine logs are never
   uploaded.
4. Never log payloads, URLs, IDs or user text. Add new attribute keys to the
   allowlist only after a privacy review.
5. Add a colocated Vitest case when the instrumentation changes a decision or a
   redaction rule.

## Adding an exporter or instrumentation backend

- Local adapters implement the OpenTelemetry `SpanExporter`,
  `LogRecordExporter` or `PushMetricExporter` interfaces in
  `shared/observability/otel.ts`.
- Remote adapters use the official OTLP exporters and remain behind the
  consent-filtering wrappers. Do not add a second queue or retry loop.
- Keep vendor configuration in `shared/observability/config.ts`; do not import a
  telemetry SDK from a feature.

## Validation

- `shared/observability/__tests__/` covers sanitization, levels/transports,
  traces, metrics/cardinality, retention/rotation, corrupt files, export,
  consent, no-upload-before-consent, OTLP payloads and FOSS gating.
- Run `npm run lint`, `npm run typecheck`, `npm run typecheck:tests`,
  `npm run test:vitest`, `npm run test:docs` and `npm run test:foss`.
- Settings/browser changes also run the existing settings E2E flow. Native
  device validation remains required for platform-specific sharing and file
  behavior.
