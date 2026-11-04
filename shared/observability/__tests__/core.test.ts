import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createObservability } from '@/shared/observability/core';
import { DEFAULT_OBSERVABILITY_PREFERENCES } from '@/shared/observability/config';
import type { BuildMetadata, DiagnosticRecord, StorageSnapshot } from '@/shared/observability/types';

vi.mock('expo-file-system', () => ({
  File: class File { exists = false; create() {} write() {} writeSync() {} async text() { return ''; } textSync() { return ''; } delete() {} },
  Directory: class Directory { exists = true; create() {} delete() {} list() { return []; } },
  Paths: { document: '/doc', cache: '/cache' },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.0', android: { versionCode: 1 }, extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: '14' } }));

const build: BuildMetadata = {
  appVersion: '1.0.0',
  buildNumber: '1',
  platform: 'android',
  osVersion: '14',
  variant: 'production',
  environment: 'test',
  sessionId: 'session1',
};

function fakeStore() {
  const records: DiagnosticRecord[] = [];
  return {
    records,
    append: vi.fn((record: DiagnosticRecord) => { records.push(record); }),
    flush: vi.fn(async () => undefined),
    initialize: vi.fn(async () => undefined),
    usage: vi.fn(async (): Promise<StorageSnapshot> => ({ bytes: 0, files: 0, retentionDays: 7, maxBytes: 10 * 1024 * 1024, corruptFiles: 0 })),
    read: vi.fn(async () => [...records].reverse()),
    clear: vi.fn(async () => { records.length = 0; }),
    close: vi.fn(async () => undefined),
  };
}

describe('observability core with OpenTelemetry', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('records local logs, errors and spans through the OTel pipeline', async () => {
    const store = fakeStore();
    const target = createObservability({
      build,
      store: store as never,
      preferences: { ...DEFAULT_OBSERVABILITY_PREFERENCES, remoteTelemetryEnabled: false },
    });
    await target.initialize();
    target.info('test.event', { operation: 'session' });
    target.captureError(new Error('boom'), { operation: 'transcript' }, false);
    target.startSpan('app.startup.test').end('ok');

    expect(store.records.some((record) => record.kind === 'log' && record.name === 'test.event')).toBe(true);
    expect(store.records.some((record) => record.kind === 'error' && record.message === 'boom')).toBe(true);
    expect(store.records.some((record) => record.kind === 'span' && record.name === 'app.startup.test')).toBe(true);
    await target.shutdown();
  });

  it('keeps sanitized correlation IDs on spans and logs', async () => {
    const store = fakeStore();
    const target = createObservability({
      build,
      store: store as never,
      preferences: { ...DEFAULT_OBSERVABILITY_PREFERENCES, remoteTelemetryEnabled: false },
    });
    await target.initialize();
    const span = target.startSpan('app.startup.trace');
    target.logWithSpan(span, 'info', 'trace.log', { operation: 'session' });
    span.end('ok');
    const log = store.records.find((record) => record.kind === 'log' && record.name === 'trace.log');
    const recordedSpan = store.records.find((record) => record.kind === 'span' && record.name === 'app.startup.trace');
    expect(log?.traceId).toBe(recordedSpan?.traceId);
    expect(log?.spanId).toBe(recordedSpan?.spanId);
    await target.shutdown();
  });

  it('exposes local records and clears them', async () => {
    const store = fakeStore();
    const pending: DiagnosticRecord[] = [];
    store.append.mockImplementation((record) => { pending.push(record); });
    store.flush.mockImplementation(async () => { store.records.push(...pending.splice(0)); });
    const target = createObservability({
      build,
      store: store as never,
      preferences: { ...DEFAULT_OBSERVABILITY_PREFERENCES, remoteTelemetryEnabled: false },
    });
    await target.initialize();
    target.info('test.visible');
    target.captureError({ message: 'Voice enrollment failed' }, { operation: 'voice.enrollment', reason: 'first-frame-timeout' }, false);
    expect(store.records).toEqual([]);
    const snapshot = await target.refreshSnapshot();
    expect(snapshot.recent.logs.some((record) => record.name === 'test.visible')).toBe(true);
    expect(snapshot.recent.errors[0]).toMatchObject({
      message: 'Voice enrollment failed',
      attrs: { operation: 'voice.enrollment', reason: 'first-frame-timeout' },
    });
    await target.clearLocal();
    expect(store.records).toEqual([]);
    await target.shutdown();
  });
});
