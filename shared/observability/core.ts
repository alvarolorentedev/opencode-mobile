import { context, trace, SpanStatusCode, type Attributes, type Counter, type Gauge, type Histogram, type Span as OtelSpan, type Tracer } from '@opentelemetry/api';

import { DEFAULT_OBSERVABILITY_PREFERENCES, readBuildMetadata, readRemoteOtlpConfig } from '@/shared/observability/config';
import { createOtelPipeline, type EmittedLog, type OtelPipeline } from '@/shared/observability/otel';
import { sanitizeAttributes, sanitizeError, sanitizeLevel, sanitizeName } from '@/shared/observability/sanitize';
import { DIAGNOSTICS_MAX_BYTES, DIAGNOSTICS_RETENTION_DAYS, DiagnosticsStore } from '@/shared/observability/storage/jsonl-store';
import { writeDiagnosticReport } from '@/shared/observability/storage/report';
import type {
  BuildMetadata,
  ExportOptions,
  Observability,
  ObservabilityLevel,
  ObservabilityPreferences,
  ObservabilitySnapshot,
  ObservabilityStatus,
  SafeAttributes,
  Span,
} from '@/shared/observability/types';

type Options = {
  build?: BuildMetadata;
  preferences?: ObservabilityPreferences;
  store?: DiagnosticsStore;
  pipeline?: OtelPipeline;
  remoteAvailable?: boolean;
  forceRemoteDisabled?: boolean;
  startedAt?: number;
};

function otelAttributes(attrs: SafeAttributes | undefined): Attributes {
  return Object.fromEntries(Object.entries(sanitizeAttributes(attrs) ?? {}).filter(([, value]) => value !== undefined)) as Attributes;
}

function emptySnapshot(preferences: ObservabilityPreferences, remoteAvailable: boolean): ObservabilitySnapshot {
  return {
    enabled: preferences.diagnosticsEnabled,
    level: preferences.diagnosticsLevel,
    remoteAvailable,
    remoteTelemetryEnabled: preferences.remoteTelemetryEnabled,
    remoteCrashReports: preferences.remoteCrashReports,
    remotePerformance: preferences.remotePerformance,
    storage: {
      bytes: 0,
      files: 0,
      retentionDays: DIAGNOSTICS_RETENTION_DAYS,
      maxBytes: DIAGNOSTICS_MAX_BYTES,
      corruptFiles: 0,
    },
    metrics: [],
    recent: { logs: [], errors: [], spans: [] },
  };
}

class WrappedSpan implements Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startedAt = Date.now();
  private attributes: SafeAttributes;

  constructor(
    readonly otelSpan: OtelSpan,
    private readonly tracer: Tracer,
    spanName: string,
    attrs?: SafeAttributes,
    parentSpanId?: string,
  ) {
    const spanContext = otelSpan.spanContext();
    this.traceId = spanContext.traceId;
    this.spanId = spanContext.spanId;
    this.parentSpanId = parentSpanId;
    this.name = spanName;
    this.attributes = sanitizeAttributes(attrs) ?? {};
  }

  setAttribute(key: string, value: string | number | boolean) {
    const next = sanitizeAttributes({ ...this.attributes, [key]: value });
    this.attributes = next ?? {};
    this.otelSpan.setAttribute(key, value);
  }

  setAttributes(attrs: SafeAttributes) {
    const next = sanitizeAttributes({ ...this.attributes, ...attrs }) ?? {};
    this.attributes = next;
    for (const [key, value] of Object.entries(next)) {
      if (value !== undefined) this.otelSpan.setAttribute(key, value);
    }
  }

  end(status: ObservabilityStatus = 'ok', attrs?: SafeAttributes) {
    const merged = sanitizeAttributes({ ...this.attributes, ...attrs });
    if (merged) {
      for (const [key, value] of Object.entries(merged)) {
        if (value !== undefined) this.otelSpan.setAttribute(key, value);
      }
    }
    this.otelSpan.setStatus({
      code: status === 'error' ? SpanStatusCode.ERROR : status === 'ok' ? SpanStatusCode.OK : SpanStatusCode.UNSET,
    });
    this.otelSpan.end();
  }

  child(name: string, attrs?: SafeAttributes) {
    const parentContext = trace.setSpan(context.active(), this.otelSpan);
    const child = this.tracer.startSpan(sanitizeName(name), { attributes: otelAttributes(attrs) }, parentContext);
    return new WrappedSpan(child, this.tracer, sanitizeName(name), attrs, this.spanId);
  }
}

export function createObservability(options: Options = {}): Observability {
  const build = options.build ?? readBuildMetadata();
  let preferences = options.preferences ?? DEFAULT_OBSERVABILITY_PREFERENCES;
  const remoteConfig = options.forceRemoteDisabled ? undefined : readRemoteOtlpConfig();
  const remoteAvailable = options.remoteAvailable ?? Boolean(remoteConfig || options.pipeline);
  const store = options.store ?? new DiagnosticsStore();
  const listeners = new Set<() => void>();
  const startedAt = options.startedAt ?? Date.now();
  const startupMarks = new Set<string>();
  let snapshot = emptySnapshot(preferences, remoteAvailable);
  let initialized = false;
  let refreshInFlight: Promise<ObservabilitySnapshot> | undefined;
  let closed = false;

  const pipeline = options.pipeline ?? createOtelPipeline({
    build,
    remote: remoteConfig,
    append: (record) => store.append(record),
    getConsent: () => ({
      telemetry: preferences.remoteTelemetryEnabled,
      crash: preferences.remoteCrashReports,
      performance: preferences.remotePerformance,
    }),
  });

  const counters = new Map<string, Counter>();
  const gauges = new Map<string, Gauge>();
  const histograms = new Map<string, Histogram>();

  const emitLocal = (record: EmittedLog) => {
    if (closed || !preferences.diagnosticsEnabled) return;
    pipeline.emitLocal({ ...record, name: sanitizeName(record.name), attrs: sanitizeAttributes(record.attrs) });
  };

  const captureError = (error: unknown, attrs?: SafeAttributes, remote = true) => {
    const details = sanitizeError(error);
    const record: EmittedLog = {
      level: 'error',
      name: 'app.error',
      message: details.message,
      stack: details.stack,
      attrs: sanitizeAttributes({
        ...attrs,
        errorName: details.name,
        ...(details.code !== undefined ? { reason: String(details.code) } : {}),
      }),
      kind: 'error',
    };
    emitLocal(record);
    if (remote) pipeline.emitRemoteError(record);
  };

  const startSpan = (name: string, attrs?: SafeAttributes) => {
    const parent = trace.getSpan(context.active());
    const span = pipeline.tracer.startSpan(sanitizeName(name), { attributes: otelAttributes(attrs) }, context.active());
    return new WrappedSpan(span, pipeline.tracer, sanitizeName(name), attrs, parent?.spanContext().spanId);
  };

  const span = async <T,>(name: string, attrs: SafeAttributes | undefined, run: (value: Span) => T | Promise<T>): Promise<T> => {
    const active = startSpan(name, attrs) as WrappedSpan;
    const activeContext = trace.setSpan(context.active(), active.otelSpan);
    return context.with(activeContext, async () => {
      try {
        const result = await run(active);
        active.end('ok');
        return result;
      } catch (error) {
        active.end('error');
        captureError(error, { operation: sanitizeName(name) });
        throw error;
      }
    });
  };

  const markStartup = (phase: string, attrs?: SafeAttributes) => {
    const safePhase = sanitizeName(phase);
    if (startupMarks.has(safePhase)) return;
    startupMarks.add(safePhase);
    const durationMs = Math.max(0, Date.now() - startedAt);
    emitLocal({ level: 'info', name: 'app.startup', attrs: { ...attrs, phase: safePhase, durationMs }, message: `startup ${safePhase}` });
  };

  const refreshSnapshot = () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      await store.flush();
      const [storage, records] = await Promise.all([store.usage(), store.read(300)]);
      const errors = records.filter((record) => record.kind === 'error');
      const next: ObservabilitySnapshot = {
        enabled: preferences.diagnosticsEnabled,
        level: preferences.diagnosticsLevel,
        remoteAvailable,
        remoteTelemetryEnabled: preferences.remoteTelemetryEnabled,
        remoteCrashReports: preferences.remoteCrashReports,
        remotePerformance: preferences.remotePerformance,
        storage,
        metrics: records.filter((record) => record.kind === 'metric').slice(0, 120),
        recent: {
          logs: records.filter((record) => record.kind === 'log').slice(0, 120),
          errors: errors.slice(0, 40),
          spans: records.filter((record) => record.kind === 'span').slice(0, 80),
        },
        ...(errors[0] ? { lastFailure: errors[0] } : {}),
      };
      snapshot = next;
      for (const listener of listeners) listener();
      return next;
    })().finally(() => { refreshInFlight = undefined; });
    return refreshInFlight;
  };

  const configure = (next: ObservabilityPreferences) => {
    const previous = preferences;
    preferences = next;
    if (preferences.remoteTelemetryEnabled !== previous.remoteTelemetryEnabled
      || preferences.remoteCrashReports !== previous.remoteCrashReports
      || preferences.remotePerformance !== previous.remotePerformance) {
      pipeline.setRemoteEnabled(
        preferences.remoteTelemetryEnabled && (preferences.remoteCrashReports || preferences.remotePerformance),
      );
    }
    snapshot = {
      ...snapshot,
      enabled: preferences.diagnosticsEnabled,
      level: preferences.diagnosticsLevel,
      remoteAvailable,
      remoteTelemetryEnabled: preferences.remoteTelemetryEnabled,
      remoteCrashReports: preferences.remoteCrashReports,
      remotePerformance: preferences.remotePerformance,
    };
    for (const listener of listeners) listener();
    if (initialized) void refreshSnapshot();
  };

  const initialize = async () => {
    if (initialized) return;
    initialized = true;
    pipeline.setRemoteEnabled(
      preferences.remoteTelemetryEnabled && (preferences.remoteCrashReports || preferences.remotePerformance),
    );
    await store.initialize();
    await refreshSnapshot();
  };

  const flush = async () => {
    await pipeline.forceFlush();
    await refreshSnapshot();
  };

  const clearLocal = async () => {
    await store.clear();
    await refreshSnapshot();
  };

  const exportReport = async (exportOptions: ExportOptions) => {
    await store.flush();
    return writeDiagnosticReport({ store, build, preferences, options: exportOptions });
  };

  return {
    log(level: ObservabilityLevel, name: string, attrs?: SafeAttributes) {
      emitLocal({ level: sanitizeLevel(level), name, attrs });
    },
    logWithSpan(activeSpan: Span, level: ObservabilityLevel, name: string, attrs?: SafeAttributes) {
      emitLocal({ level: sanitizeLevel(level), name, attrs, traceId: activeSpan.traceId, spanId: activeSpan.spanId });
    },
    debug: (name, attrs) => emitLocal({ level: 'debug', name, attrs }),
    info: (name, attrs) => emitLocal({ level: 'info', name, attrs }),
    warn: (name, attrs) => emitLocal({ level: 'warn', name, attrs }),
    error: (name, attrs) => emitLocal({ level: 'error', name, attrs }),
    startSpan,
    span,
    counter(name, value = 1, labels) {
      const key = sanitizeName(name);
      let counter = counters.get(key);
      if (!counter) {
        counter = pipeline.meter.createCounter(key);
        counters.set(key, counter);
      }
      counter.add(value, otelAttributes(labels));
    },
    gauge(name, value, labels) {
      const key = sanitizeName(name);
      let gauge = gauges.get(key);
      if (!gauge) {
        gauge = pipeline.meter.createGauge(key);
        gauges.set(key, gauge);
      }
      gauge.record(value, otelAttributes(labels));
    },
    histogram(name, value, unit, labels) {
      const key = sanitizeName(name);
      let histogram = histograms.get(key);
      if (!histogram) {
        histogram = pipeline.meter.createHistogram(key, unit ? { unit } : undefined);
        histograms.set(key, histogram);
      }
      histogram.record(value, otelAttributes(labels));
    },
    captureError,
    markStartup,
    configure,
    getSnapshot: () => snapshot,
    refreshSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    initialize,
    shutdown: async () => {
      closed = true;
      await flush();
      pipeline.setRemoteEnabled(false);
      await pipeline.shutdown();
      await store.close();
    },
    clearLocal,
    exportReport,
    flush,
  } as Observability;
}
