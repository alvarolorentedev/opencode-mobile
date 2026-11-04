import { context, trace, type Attributes, type Meter, type Tracer } from '@opentelemetry/api';
import { SeverityNumber, type Logger as OtelLogger } from '@opentelemetry/api-logs';
import { ExportResultCode, hrTimeToMilliseconds, type ExportResult } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider, SimpleLogRecordProcessor, type LogRecordExporter, type LogRecordProcessor, type ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { AggregationTemporality, MeterProvider, PeriodicExportingMetricReader, type DataPoint, type Histogram, type PushMetricExporter, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { AlwaysOnSampler, BatchSpanProcessor, SimpleSpanProcessor, TracerProvider, type ReadableSpan, type SpanExporter, type SpanProcessor } from '@opentelemetry/sdk-trace';

import type { RemoteOtlpConfig } from '@/shared/observability/config';
import { sanitizeAttributes, sanitizeName, sanitizeRecord } from '@/shared/observability/sanitize';
import type { BuildMetadata, DiagnosticRecord, ObservabilityLevel, SafeAttributes } from '@/shared/observability/types';

export type EmittedLog = {
  level: ObservabilityLevel;
  name: string;
  message?: string;
  stack?: string;
  attrs?: SafeAttributes;
  traceId?: string;
  spanId?: string;
  kind?: 'log' | 'error';
};

export type OtelPipeline = {
  tracer: Tracer;
  meter: Meter;
  emitLocal: (record: EmittedLog) => void;
  emitRemoteError: (record: EmittedLog) => void;
  setRemoteEnabled: (enabled: boolean) => void;
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
};

type Options = {
  build: BuildMetadata;
  remote?: RemoteOtlpConfig;
  append: (record: DiagnosticRecord) => void;
  getConsent: () => { telemetry: boolean; crash: boolean; performance: boolean };
  /** Test seam: replace the OTLP exporters with in-memory exporters. */
  remoteExporters?: {
    traces?: SpanExporter;
    logs?: LogRecordExporter;
    metrics?: PushMetricExporter;
  };
};

function signalUrl(endpoint: string, signal: 'traces' | 'logs' | 'metrics') {
  if (/\/v1\/(?:traces|logs|metrics)$/.test(endpoint)) return endpoint.replace(/\/v1\/(?:traces|logs|metrics)$/, `/v1/${signal}`);
  return `${endpoint}/v1/${signal}`;
}

function resource(build: BuildMetadata): Resource {
  return resourceFromAttributes({
    'service.name': 'opencode-mobile',
    'service.version': build.appVersion,
    'service.instance.id': build.sessionId,
    'deployment.environment': build.environment,
    'app.build': build.buildNumber,
    'app.variant': build.variant,
    'os.type': build.platform,
    ...(build.osVersion ? { 'os.version': build.osVersion } : {}),
    'telemetry.sdk.name': 'opencode-mobile',
    'telemetry.sdk.language': 'javascript',
  });
}

function severity(level: ObservabilityLevel) {
  if (level === 'debug') return { number: SeverityNumber.DEBUG, text: 'DEBUG' };
  if (level === 'warn') return { number: SeverityNumber.WARN, text: 'WARN' };
  if (level === 'error') return { number: SeverityNumber.ERROR, text: 'ERROR' };
  return { number: SeverityNumber.INFO, text: 'INFO' };
}

function otelAttributes(attrs: SafeAttributes | undefined): Attributes {
  return Object.fromEntries(Object.entries(sanitizeAttributes(attrs) ?? {}).filter(([, value]) => value !== undefined)) as Attributes;
}

function logAttributes(record: EmittedLog) {
  return {
    ...otelAttributes(record.attrs),
    'diagnostic.name': sanitizeName(record.name),
    'diagnostic.kind': record.kind ?? 'log',
    ...(record.stack ? { 'exception.stacktrace': record.stack } : {}),
  };
}

function logContext(record: EmittedLog) {
  if (!record.traceId || !record.spanId) return undefined;
  const span = trace.wrapSpanContext({ traceId: record.traceId, spanId: record.spanId, traceFlags: 1 });
  return trace.setSpan(context.active(), span);
}

function emitLog(logger: OtelLogger, record: EmittedLog) {
  const level = severity(record.level);
  logger.emit({
    severityNumber: level.number,
    severityText: level.text,
    body: record.message ?? sanitizeName(record.name),
    attributes: logAttributes(record),
    context: logContext(record),
  });
}

function localSpanRate(name: string) {
  if (name.startsWith('app.startup') || name.startsWith('connection.') || name.startsWith('cloud-link.') || name.startsWith('workspace.')) return 1;
  if (name.startsWith('session.') || name.startsWith('transcript.')) return 0.5;
  return 0.15;
}

function remoteSpanRate(name: string) {
  return name.startsWith('app.startup') ? 0.2 : 0.05;
}

function keepLocalSpan(span: ReadableSpan) {
  return span.status.code === 2 || Math.random() < localSpanRate(span.name);
}

function keepRemoteSpan(span: ReadableSpan) {
  return span.status.code === 2 || Math.random() < remoteSpanRate(span.name);
}

function spanRecord(span: ReadableSpan, build: BuildMetadata): DiagnosticRecord {
  const spanContext = span.spanContext();
  const status = span.status.code === 2 ? 'error' : 'ok';
  return sanitizeRecord({
    v: 1,
    ts: hrTimeToMilliseconds(span.startTime),
    kind: 'span',
    name: span.name,
    durationMs: hrTimeToMilliseconds(span.duration),
    status,
    attrs: Object.fromEntries(Object.entries(span.attributes).filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) as SafeAttributes,
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    ...(span.parentSpanContext?.spanId ? { parentSpanId: span.parentSpanContext.spanId } : {}),
    sessionId: build.sessionId,
  });
}

function logRecord(log: ReadableLogRecord, build: BuildMetadata): DiagnosticRecord {
  const attrs = Object.fromEntries(Object.entries(log.attributes).filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) as SafeAttributes;
  const rawName = attrs['diagnostic.name'];
  const level: ObservabilityLevel = (log.severityNumber ?? 0) >= SeverityNumber.ERROR ? 'error'
    : (log.severityNumber ?? 0) >= SeverityNumber.WARN ? 'warn'
      : (log.severityNumber ?? 0) >= SeverityNumber.INFO ? 'info' : 'debug';
  return sanitizeRecord({
    v: 1,
    ts: hrTimeToMilliseconds(log.hrTime),
    kind: attrs['diagnostic.kind'] === 'error' ? 'error' : 'log',
    level,
    name: typeof rawName === 'string' ? rawName : 'app',
    message: typeof log.body === 'string' ? log.body : undefined,
    stack: typeof attrs['exception.stacktrace'] === 'string' ? attrs['exception.stacktrace'] : undefined,
    attrs,
    ...(log.spanContext ? { traceId: log.spanContext.traceId, spanId: log.spanContext.spanId } : {}),
    sessionId: build.sessionId,
  });
}

function histogramPercentile(histogram: Histogram) {
  const target = Math.max(1, Math.ceil(histogram.count * 0.95));
  let seen = 0;
  for (let index = 0; index < histogram.buckets.counts.length; index += 1) {
    seen += histogram.buckets.counts[index] ?? 0;
    if (seen >= target) return histogram.buckets.boundaries[index] ?? histogram.max ?? 0;
  }
  return histogram.max ?? 0;
}

function metricRecords(metrics: ResourceMetrics, build: BuildMetadata): DiagnosticRecord[] {
  const records: DiagnosticRecord[] = [];
  for (const scope of metrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      for (const point of metric.dataPoints as DataPoint<number | Histogram>[]) {
        const isHistogram = metric.dataPointType === 0;
        const histogram = isHistogram ? point.value as Histogram : undefined;
        const value = isHistogram ? histogramPercentile(histogram!) : point.value as number;
        records.push(sanitizeRecord({
          v: 1,
          ts: hrTimeToMilliseconds(point.endTime),
          kind: 'metric',
          name: metric.descriptor.name,
          value,
          unit: metric.descriptor.unit || undefined,
          attrs: sanitizeAttributes({
            ...point.attributes,
            metricType: metric.dataPointType === 3 ? 'counter' : metric.dataPointType === 2 ? 'gauge' : 'histogram',
            ...(histogram ? { count: histogram.count, durationMs: histogram.count ? Math.round((histogram.sum ?? 0) / histogram.count) : 0 } : {}),
          }),
          sessionId: build.sessionId,
        }));
      }
    }
  }
  return records;
}

class LocalSpanExporter implements SpanExporter {
  constructor(private readonly append: (record: DiagnosticRecord) => void, private readonly build: BuildMetadata) {}
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void) {
    for (const span of spans) if (keepLocalSpan(span)) this.append(spanRecord(span, this.build));
    resultCallback({ code: ExportResultCode.SUCCESS });
  }
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

class LocalLogExporter implements LogRecordExporter {
  constructor(private readonly append: (record: DiagnosticRecord) => void, private readonly build: BuildMetadata) {}
  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void) {
    for (const log of logs) this.append(logRecord(log, this.build));
    resultCallback({ code: ExportResultCode.SUCCESS });
  }
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

class LocalMetricExporter implements PushMetricExporter {
  constructor(private readonly append: (record: DiagnosticRecord) => void, private readonly build: BuildMetadata) {}
  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void) {
    for (const record of metricRecords(metrics, this.build)) this.append(record);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }
  selectAggregationTemporality() { return AggregationTemporality.CUMULATIVE; }
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

class ConsentSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter, private readonly allow: () => boolean) {}
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void) {
    if (!this.allow()) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    const filtered = spans.filter(keepRemoteSpan);
    if (filtered.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.delegate.export(filtered, resultCallback);
  }
  forceFlush() { return this.delegate.forceFlush?.() ?? Promise.resolve(); }
  shutdown() { return this.delegate.shutdown(); }
}

class ConsentLogExporter implements LogRecordExporter {
  constructor(private readonly delegate: LogRecordExporter, private readonly allow: () => boolean) {}
  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void) {
    if (!this.allow()) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.delegate.export(logs, resultCallback);
  }
  forceFlush() { return this.delegate.forceFlush(); }
  // The delegate is shared across consent batches and closed by the pipeline.
  shutdown() { return Promise.resolve(); }
}

class ConsentMetricExporter implements PushMetricExporter {
  constructor(private readonly delegate: PushMetricExporter, private readonly allow: () => boolean) {}
  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void) {
    if (!this.allow()) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.delegate.export(metrics, resultCallback);
  }
  selectAggregationTemporality() { return AggregationTemporality.CUMULATIVE; }
  forceFlush() { return this.delegate.forceFlush(); }
  shutdown() { return this.delegate.shutdown(); }
}

class SwitchableSpanProcessor implements SpanProcessor {
  private processor?: BatchSpanProcessor;
  constructor(private readonly create: () => BatchSpanProcessor) {}
  setEnabled(enabled: boolean) {
    if (enabled) {
      this.processor ??= this.create();
      return;
    }
    const previous = this.processor;
    this.processor = undefined;
    if (previous) void previous.shutdown();
  }
  onStart(span: Parameters<SpanProcessor['onStart']>[0], parentContext: Parameters<SpanProcessor['onStart']>[1]) {
    this.processor?.onStart(span, parentContext);
  }
  onEnd(span: ReadableSpan) {
    this.processor?.onEnd(span);
  }
  forceFlush() {
    return this.processor?.forceFlush() ?? Promise.resolve();
  }
  shutdown() {
    const previous = this.processor;
    this.processor = undefined;
    return previous?.shutdown() ?? Promise.resolve();
  }
}

class SwitchableLogProcessor implements LogRecordProcessor {
  private processor?: BatchLogRecordProcessor;
  constructor(private readonly create: (isCurrent: () => boolean) => BatchLogRecordProcessor) {}
  setEnabled(enabled: boolean) {
    if (!enabled) {
      void this.shutdown();
    } else if (!this.processor) {
      const processor: BatchLogRecordProcessor = this.create(() => this.processor === processor);
      this.processor = processor;
    }
  }
  onEmit(record: Parameters<LogRecordProcessor['onEmit']>[0], contextValue?: Parameters<LogRecordProcessor['onEmit']>[1]) {
    this.processor?.onEmit(record);
  }
  forceFlush() {
    return this.processor?.forceFlush() ?? Promise.resolve();
  }
  shutdown() {
    const previous = this.processor;
    this.processor = undefined;
    return previous?.shutdown() ?? Promise.resolve();
  }
}

export function createOtelPipeline(options: Options): OtelPipeline {
  const { build, remote, append, getConsent } = options;
  const providerResource = resource(build);

  const remoteTraceExporter = remote
    ? options.remoteExporters?.traces ?? new OTLPTraceExporter({
        url: signalUrl(remote.endpoint, 'traces'),
        headers: { Authorization: remote.authorization },
        timeoutMillis: 10_000,
        concurrencyLimit: 1,
      })
    : undefined;
  const remoteLogExporter = remote
    ? options.remoteExporters?.logs ?? new OTLPLogExporter({
        url: signalUrl(remote.endpoint, 'logs'),
        headers: { Authorization: remote.authorization },
        timeoutMillis: 10_000,
        concurrencyLimit: 1,
      })
    : undefined;
  const remoteMetricExporter = remote
    ? options.remoteExporters?.metrics ?? new OTLPMetricExporter({
        url: signalUrl(remote.endpoint, 'metrics'),
        headers: { Authorization: remote.authorization },
        timeoutMillis: 10_000,
        concurrencyLimit: 1,
      })
    : undefined;

  const allow = (category: 'crash' | 'performance') => () => {
    const consent = getConsent();
    return consent.telemetry && (category === 'crash' ? consent.crash : consent.performance);
  };

  const remoteSpanProcessor = remoteTraceExporter
    ? new SwitchableSpanProcessor(() => new BatchSpanProcessor({
        exporter: new ConsentSpanExporter(remoteTraceExporter, allow('performance')),
        maxQueueSize: 100,
        maxExportBatchSize: 20,
        scheduledDelayMillis: 30_000,
        exportTimeoutMillis: 10_000,
      }))
    : undefined;
  const allowLogs = allow('crash');
  const remoteLogProcessor = remoteLogExporter
    ? new SwitchableLogProcessor((isCurrent) => new BatchLogRecordProcessor({
        exporter: new ConsentLogExporter(remoteLogExporter, () => isCurrent() && allowLogs()),
        maxQueueSize: 100,
        maxExportBatchSize: 20,
        scheduledDelayMillis: 30_000,
        exportTimeoutMillis: 10_000,
      }))
    : undefined;

  const tracerProvider = new TracerProvider({
    resource: providerResource,
    sampler: new AlwaysOnSampler(),
    spanProcessors: [
      new SimpleSpanProcessor({ exporter: new LocalSpanExporter(append, build) }),
      ...(remoteSpanProcessor ? [remoteSpanProcessor] : []),
    ],
  });
  const tracer = tracerProvider.getTracer('opencode-mobile', build.appVersion);

  const loggerProvider = new LoggerProvider({
    resource: providerResource,
    processors: [new SimpleLogRecordProcessor({ exporter: new LocalLogExporter(append, build) })],
  });
  const remoteLoggerProvider = remoteLogProcessor
    ? new LoggerProvider({ resource: providerResource, processors: [remoteLogProcessor] })
    : undefined;
  const localLoggers = new Map<string, OtelLogger>();
  const remoteLoggers = new Map<string, OtelLogger>();

  const meterProvider = new MeterProvider({
    resource: providerResource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new LocalMetricExporter(append, build),
        exportIntervalMillis: 60_000,
        exportTimeoutMillis: 10_000,
      }),
      ...(remoteMetricExporter ? [new PeriodicExportingMetricReader({
        exporter: new ConsentMetricExporter(remoteMetricExporter, allow('performance')),
        exportIntervalMillis: 60_000,
        exportTimeoutMillis: 10_000,
      })] : []),
    ],
  });
  const meter = meterProvider.getMeter('opencode-mobile', build.appVersion);

  const setRemoteEnabled = (enabled: boolean) => {
    remoteSpanProcessor?.setEnabled(enabled);
    remoteLogProcessor?.setEnabled(enabled && allowLogs());
  };

  return {
    tracer,
    meter,
    emitLocal(record) {
      const name = sanitizeName(record.name);
      let logger = localLoggers.get(name);
      if (!logger) {
        logger = loggerProvider.getLogger(name, build.appVersion);
        localLoggers.set(name, logger);
      }
      emitLog(logger, { ...record, name });
    },
    emitRemoteError(record) {
      if (!remoteLogProcessor || !allowLogs()) return;
      const name = sanitizeName(record.name);
      let logger = remoteLoggers.get(name);
      if (!logger) {
        logger = remoteLoggerProvider?.getLogger(name, build.appVersion);
        if (!logger) return;
        remoteLoggers.set(name, logger);
      }
      emitLog(logger, { ...record, name, kind: 'error' });
    },
    setRemoteEnabled,
    async forceFlush() {
      await Promise.all([tracerProvider.forceFlush(), loggerProvider.forceFlush(), remoteLoggerProvider?.forceFlush() ?? Promise.resolve(), meterProvider.forceFlush()]);
    },
    async shutdown() {
      await Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown(), remoteLoggerProvider?.shutdown() ?? Promise.resolve(), meterProvider.shutdown()]);
      await remoteLogExporter?.shutdown();
    },
  };
}
