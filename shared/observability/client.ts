import type { Observability, ObservabilityLevel, SafeAttributes, Span } from '@/shared/observability/types';

// Lightweight instrumentation entrypoint. Shared services and features import
// this module instead of the application singleton, so protocol tests and
// background workers never load the file-system/logging composition.
let target: Observability | undefined;

export function setObservabilityTarget(next: Observability | undefined) {
  target = next;
}

const noopSpan: Span = {
  traceId: '0'.repeat(32),
  spanId: '0'.repeat(16),
  name: 'noop',
  startedAt: Date.now(),
  setAttribute: () => undefined,
  setAttributes: () => undefined,
  end: () => undefined,
  child: () => noopSpan,
};

export const telemetry = {
  log(level: ObservabilityLevel, name: string, attrs?: SafeAttributes) {
    target?.log(level, name, attrs);
  },
  logWithSpan(span: Span, level: ObservabilityLevel, name: string, attrs?: SafeAttributes) {
    target?.logWithSpan(span, level, name, attrs);
  },
  debug(name: string, attrs?: SafeAttributes) {
    target?.debug(name, attrs);
  },
  info(name: string, attrs?: SafeAttributes) {
    target?.info(name, attrs);
  },
  warn(name: string, attrs?: SafeAttributes) {
    target?.warn(name, attrs);
  },
  error(name: string, attrs?: SafeAttributes) {
    target?.error(name, attrs);
  },
  startSpan(name: string, attrs?: SafeAttributes) {
    return target?.startSpan(name, attrs) ?? noopSpan;
  },
  counter(name: string, value?: number, labels?: SafeAttributes) {
    target?.counter(name, value, labels);
  },
  gauge(name: string, value: number, labels?: SafeAttributes) {
    target?.gauge(name, value, labels);
  },
  histogram(name: string, value: number, unit?: string, labels?: SafeAttributes) {
    target?.histogram(name, value, unit, labels);
  },
  captureError(error: unknown, attrs?: SafeAttributes, remote = true) {
    target?.captureError(error, attrs, remote);
  },
  markStartup(phase: string, attrs?: SafeAttributes) {
    target?.markStartup(phase, attrs);
  },
};

export async function withSpan<T>(
  name: string,
  attrs: SafeAttributes | undefined,
  run: (span: Span) => T | Promise<T>,
): Promise<T> {
  if (!target) return run(noopSpan);
  return target.span(name, attrs, run);
}
