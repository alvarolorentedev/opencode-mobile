import { describe, expect, it } from 'vitest';
import { ExportResultCode } from '@opentelemetry/core';
import { SpanStatusCode } from '@opentelemetry/api';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

import { createOtelPipeline } from '@/shared/observability/otel';
import type { BuildMetadata, DiagnosticRecord } from '@/shared/observability/types';

const build: BuildMetadata = {
  appVersion: '1.0.0',
  buildNumber: '1',
  platform: 'android',
  osVersion: '14',
  variant: 'production',
  environment: 'test',
  sessionId: 'session1',
};

class FakeSpanExporter implements SpanExporter {
  spans: ReadableSpan[] = [];
  export(spans: ReadableSpan[], resultCallback: (result: { code: ExportResultCode }) => void) {
    this.spans.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }
  shutdown() { return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
}

class FakeLogExporter implements LogRecordExporter {
  logs: ReadableLogRecord[] = [];
  export(logs: ReadableLogRecord[], resultCallback: (result: { code: ExportResultCode }) => void) {
    this.logs.push(...logs);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }
  shutdown() { return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
}

class FakeMetricExporter implements PushMetricExporter {
  exports = 0;
  export(_metrics: ResourceMetrics, resultCallback: (result: { code: ExportResultCode }) => void) {
    this.exports += 1;
    resultCallback({ code: ExportResultCode.SUCCESS });
  }
  shutdown() { return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
}

function setup() {
  const local: DiagnosticRecord[] = [];
  const traces = new FakeSpanExporter();
  const logs = new FakeLogExporter();
  const metrics = new FakeMetricExporter();
  let consent = { telemetry: false, crash: false, performance: false };
  const pipeline = createOtelPipeline({
    build,
    remote: { endpoint: 'https://otlp.example.test/otlp', authorization: 'Basic test', environment: 'test' },
    append: (record) => local.push(record),
    getConsent: () => consent,
    remoteExporters: { traces, logs, metrics },
  });
  return {
    local,
    traces,
    logs,
    metrics,
    pipeline,
    allow(next: Partial<typeof consent>) {
      consent = { ...consent, ...next };
    },
  };
}

describe('OpenTelemetry pipeline adapters', () => {
  it('keeps local logs and sends remote errors only after consent', async () => {
    const view = setup();
    view.pipeline.setRemoteEnabled(false);
    view.pipeline.emitLocal({ level: 'info', name: 'local.event', attrs: { operation: 'session' } });
    view.pipeline.emitRemoteError({ level: 'error', name: 'app.error', message: 'boom', kind: 'error' });
    await view.pipeline.forceFlush();
    expect(view.local.some((record) => record.name === 'local.event')).toBe(true);
    expect(view.logs.logs).toHaveLength(0);

    view.allow({ telemetry: true, crash: true, performance: true });
    view.pipeline.setRemoteEnabled(true);
    view.pipeline.emitRemoteError({ level: 'error', name: 'app.error', message: 'boom', kind: 'error' });
    await view.pipeline.forceFlush();
    expect(view.logs.logs.length).toBeGreaterThan(0);
    await view.pipeline.shutdown();
  });

  it('drops queued remote errors when consent is revoked', async () => {
    const view = setup();
    view.allow({ telemetry: true, crash: true, performance: true });
    view.pipeline.setRemoteEnabled(true);
    view.pipeline.emitRemoteError({ level: 'error', name: 'app.error', message: 'queued', kind: 'error' });
    view.allow({ telemetry: false, crash: false, performance: false });
    view.pipeline.setRemoteEnabled(false);
    await view.pipeline.forceFlush();
    expect(view.logs.logs).toHaveLength(0);
    await view.pipeline.shutdown();
  });

  it('drops retired and unconsented log records while Performance stays enabled', async () => {
    const view = setup();
    view.allow({ telemetry: true, crash: true, performance: true });
    view.pipeline.setRemoteEnabled(true);
    const report = (message: string) => view.pipeline.emitRemoteError({ level: 'error', name: 'app.error', message });

    report('queued before revocation');
    view.allow({ crash: false });
    view.pipeline.setRemoteEnabled(true);
    report('created without consent');
    view.allow({ crash: true });
    view.pipeline.setRemoteEnabled(true);
    report('created after consent');
    await view.pipeline.forceFlush();
    await view.pipeline.shutdown();

    expect(view.logs.logs.map((log) => log.body)).toEqual(['created after consent']);
  });

  it('does not export remote metrics before performance consent', async () => {
    const view = setup();
    view.pipeline.meter.createCounter('test.counter').add(1);
    await view.pipeline.forceFlush();
    expect(view.metrics.exports).toBe(0);

    view.allow({ telemetry: true, crash: true, performance: true });
    view.pipeline.setRemoteEnabled(true);
    view.pipeline.meter.createCounter('test.counter').add(1);
    await view.pipeline.forceFlush();
    expect(view.metrics.exports).toBeGreaterThan(0);
    await view.pipeline.shutdown();
  });

  it('sends sampled error spans and local metrics through the SDK', async () => {
    const view = setup();
    view.allow({ telemetry: true, crash: true, performance: true });
    view.pipeline.setRemoteEnabled(true);
    const span = view.pipeline.tracer.startSpan('http.request');
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    view.pipeline.meter.createCounter('test.counter').add(1, { operation: 'session' });
    await view.pipeline.forceFlush();
    expect(view.traces.spans.some((entry) => entry.name === 'http.request')).toBe(true);
    expect(view.metrics.exports).toBeGreaterThan(0);
    expect(view.local.some((record) => record.kind === 'metric' && record.name === 'test.counter')).toBe(true);
    await view.pipeline.shutdown();
  });
});
