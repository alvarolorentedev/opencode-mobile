import { describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';

import { buildDiagnosticReport } from '@/shared/observability/storage/report';
import type { BuildMetadata, DiagnosticRecord } from '@/shared/observability/types';

vi.mock('expo-file-system', () => {
  const files = new Map<string, { content: Uint8Array | string; mtime: number }>();
  const dirs = new Set<string>(['/cache']);
  class File {
    uri: string;
    name: string;
    constructor(parent: unknown, name?: string) {
      const base = typeof parent === 'string' ? parent : (parent as { uri: string }).uri;
      this.uri = name ? `${base}/${name}` : base;
      this.name = this.uri.split('/').pop() ?? '';
    }
    get exists() { return files.has(this.uri); }
    get modificationTime() { return files.get(this.uri)?.mtime ?? 0; }
    create() { if (!files.has(this.uri)) files.set(this.uri, { content: new Uint8Array(), mtime: Date.now() }); }
    write(content: Uint8Array | string) { files.set(this.uri, { content, mtime: Date.now() }); }
    delete() { files.delete(this.uri); }
  }
  class Directory {
    uri: string;
    constructor(parent: unknown, name?: string) {
      const base = typeof parent === 'string' ? parent : (parent as { uri: string }).uri;
      this.uri = name ? `${base}/${name}` : base;
    }
    get exists() { return dirs.has(this.uri); }
    create() { dirs.add(this.uri); }
    delete() { dirs.delete(this.uri); }
    list() {
      const prefix = `${this.uri.replace(/\/$/, '')}/`;
      return [...files.keys()].filter((key) => key.startsWith(prefix)).map((key) => new File(key));
    }
  }
  return { File, Directory, Paths: { document: '/doc', cache: '/cache' }, __files: files };
});

const build: BuildMetadata = {
  appVersion: '1.0.0',
  buildNumber: '1',
  platform: 'android',
  osVersion: '14',
  variant: 'production',
  environment: 'test',
  sessionId: 'session1',
};

const records: DiagnosticRecord[] = [
  { v: 1, ts: 1, kind: 'log', level: 'info', name: 'test.log', message: 'safe' },
  { v: 1, ts: 2, kind: 'error', level: 'error', name: 'app.error', message: 'Voice enrollment failed', attrs: { operation: 'voice.enrollment', reason: 'first-frame-timeout' } },
  { v: 1, ts: 3, kind: 'span', name: 'http.request', durationMs: 4, traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
  { v: 1, ts: 4, kind: 'metric', name: 'http.request.count', value: 2 },
];

function store(includeRecords = true) {
  return {
    read: vi.fn(async () => (includeRecords ? records : [])),
    usage: vi.fn(async () => ({ bytes: 100, files: 1, retentionDays: 7, maxBytes: 10 * 1024 * 1024, corruptFiles: 0 })),
  };
}

describe('diagnostic report export', () => {
  it('writes a versioned zip with sanitized logs, spans, metrics and errors', async () => {
    const result = await buildDiagnosticReport({
      store: store() as never,
      build,
      preferences: { diagnosticsEnabled: true, diagnosticsLevel: 'normal', remoteTelemetryEnabled: true, remoteCrashReports: true, remotePerformance: true },
      options: { includeDetails: true },
    });
    const mocked = await import('expo-file-system') as unknown as { __files: Map<string, { content: Uint8Array | string }> };
    const content = mocked.__files.get(result.file.uri)?.content;
    expect(content).toBeInstanceOf(Uint8Array);
    const archive = unzipSync(content as Uint8Array);
    expect(result.fileName).toMatch(/^opencode-diagnostics-.*\.zip$/);
    expect(result.file.exists).toBe(true);
    expect(result.counts).toEqual({ log: 1, error: 1, span: 1, metric: 1 });
    expect(Object.keys(archive).sort()).toEqual(['README.txt', 'errors.jsonl', 'logs.jsonl', 'manifest.json', 'metrics.jsonl', 'spans.jsonl']);
    const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.counts).toEqual({ log: 1, error: 1, span: 1, metric: 1 });
    expect(new TextDecoder().decode(archive['logs.jsonl'])).toContain('test.log');
    expect(JSON.parse(new TextDecoder().decode(archive['errors.jsonl']))).toMatchObject({
      message: 'Voice enrollment failed',
      attrs: { operation: 'voice.enrollment', reason: 'first-frame-timeout' },
    });
  });

  it('omits detailed files when the user excludes details', async () => {
    const result = await buildDiagnosticReport({
      store: store() as never,
      build,
      preferences: { diagnosticsEnabled: true, diagnosticsLevel: 'normal', remoteTelemetryEnabled: false, remoteCrashReports: false, remotePerformance: false },
      options: { includeDetails: false },
    });
    const mocked = await import('expo-file-system') as unknown as { __files: Map<string, { content: Uint8Array | string }> };
    const archive = unzipSync(mocked.__files.get(result.file.uri)?.content as Uint8Array);
    expect(Object.keys(archive).sort()).toEqual(['README.txt', 'manifest.json']);
  });
});
