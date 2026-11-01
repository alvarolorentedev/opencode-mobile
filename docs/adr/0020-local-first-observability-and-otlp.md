# ADR 0020: Local-first observability with opt-in OTLP export

- Status: Accepted
- Date: 2026-11-01
- Deciders: maintainers
- Supersedes: —
- Related: [observability](../architecture/observability.md), [network resilience](../architecture/network-resilience.md), [F-Droid](../engineering/fdroid.md), [known gaps](../engineering/known-gaps.md)

## Context

The app already had a small request ring buffer, a per-day data-usage counter,
a synchronous last-JS-error file and a Diagnostics settings section. It had no
structured logging, persistent traces, metric aggregation, diagnostic export or
remote reporting. The existing error-reporting gap explicitly deferred remote
crash reporting because consent, scrubbing and a funded pipeline were missing.

The app runs on Expo SDK 58 / React Native 0.88 / Hermes and ships a FOSS variant
that must remain free of proprietary native libraries. Diagnostics must work
offline, must not collect prompts, source code, terminal output or credentials,
and must never make remote failures affect the product. Remote telemetry must be
independently controllable and must not transmit previously recorded local data.

## Decision

Use the OpenTelemetry JS SDK for tracing, metrics, logs, sampling, batching and
OTLP/HTTP export. Use `fflate` for ZIP/gzip. Keep only the local JSONL adapters,
sanitization, consent, local retention and the export manifest in
`shared/observability/`.

Local recording is enabled by default and bounded to approximately 7 days and
10 MB. Remote export is a generic OTLP/HTTP exporter, initially configured
for Grafana Cloud. It is disabled without credentials and in FOSS builds. The
master remote switch plus crash-report and performance categories live with the
existing global preferences; defaults are enabled for configured builds. The
exporter consumes only live events, has a memory-only bounded queue and is
stopped and cleared immediately when consent is revoked.

No native telemetry SDK is included. Native hard crashes/ANRs and remote stack
symbolication are therefore out of scope for this decision; local crash records
remain available and are ingested once into the local stream on the next launch.

## Consequences

- Local diagnostics work offline, in FOSS builds and without an account.
- Span/metric aggregation, OTLP serialization and retry behavior are maintained
  by the OpenTelemetry SDK instead of app code.
- Features expose only an allowlisted structured metadata surface; sanitization
  happens before persistence and again during export.
- Grafana Cloud (or any OTLP backend) can be enabled through build-time
  environment values without a backend server or native dependency.
- A bundled write token is extractable. It must be write-only, least-privilege
  and rotated; no read scopes. A build without credentials remains fully
  functional.
- Remote stack traces may be minified. Detailed local exports are the supported
  diagnostic attachment for issues.
- Adding a native crash adapter later must prove consent-safe initialization and
  FOSS exclusion before it is enabled.

## Alternatives considered

- **Winston:** rejected because it depends on Node streams/polyfills and is not
  a React Native runtime.
- **`react-native-logs`:** considered for the logging layer, but it only covers
  logs and would leave tracing, metric aggregation and OTLP as custom code. The
  OpenTelemetry SDK now covers all signals.
- **`loglayer`:** rejected because its transport ecosystem is Node/browser-first
  and adds packages without providing an Expo filesystem transport.
- **`expo-observe`:** rejected because it auto-collects and dispatches EAS
  Observe startup metrics in release builds by default, which conflicts with
  consent-first, local-first behavior.
- **`@grafana/faro-react-native`:** rejected because it adds
  `react-native-device-info`/MMKV and targets a Faro collector rather than a
  provider-neutral OTLP boundary.
- **`@sentry/react-native`:** deferred because native initialization and FOSS
  exclusion make consent revocation harder to guarantee. The exporter interface
  leaves room for a future isolated adapter.
- **A backend proxy:** rejected because diagnostics must work without Cloudflare
  or a hosted server, and a proxy would add an operational dependency.

## Follow-up

- [x] Update architecture, F-Droid, settings and functional-spec docs.
- [x] Add local, consent, export and OTLP tests.
- [x] Read Grafana Cloud connection values from release GitHub variables/secrets
  only for Android/iOS builds; FOSS and E2E builds never receive the token.
- [ ] Add a consent-safe native crash adapter only if a real device validation
  plan and FOSS exclusion proof exist.
- [ ] Revisit remote symbolication and retention cost after the first production
  telemetry window.
