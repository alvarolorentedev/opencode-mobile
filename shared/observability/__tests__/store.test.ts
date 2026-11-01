import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Directory, File } from 'expo-file-system';

import { DiagnosticsStore, DIAGNOSTICS_MAX_BYTES, DIAGNOSTICS_RETENTION_DAYS } from '@/shared/observability/storage/jsonl-store';

vi.mock('expo-file-system', () => {
  const files = new Map<string, { content: string; mtime: number }>();
  const dirs = new Set<string>(['/doc']);
  function join(parent: unknown, name?: string) {
    if (name === undefined) return String(parent);
    const base = typeof parent === 'string' ? parent : (parent as { uri: string }).uri;
    return `${base.replace(/\/$/, '')}/${name}`;
  }
  class File {
    uri: string;
    name: string;
    constructor(parent: unknown, name?: string) {
      this.uri = join(parent, name);
      this.name = this.uri.split('/').pop() ?? '';
    }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.content.length ?? 0; }
    get modificationTime() { return files.get(this.uri)?.mtime ?? 0; }
    create() { if (!files.has(this.uri)) files.set(this.uri, { content: '', mtime: Date.now() }); }
    write(content: string, options?: { append?: boolean }) {
      const previous = options?.append ? files.get(this.uri)?.content ?? '' : '';
      files.set(this.uri, { content: previous + content, mtime: Date.now() });
    }
    writeSync(content: string) { this.write(content); }
    async text() { return files.get(this.uri)?.content ?? ''; }
    textSync() { return files.get(this.uri)?.content ?? ''; }
    delete() { files.delete(this.uri); }
  }
  class Directory {
    uri: string;
    constructor(parent: unknown, name?: string) { this.uri = join(parent, name); }
    get exists() { return dirs.has(this.uri); }
    create() { dirs.add(this.uri); }
    delete() {
      dirs.delete(this.uri);
      for (const key of [...files.keys()]) if (key.startsWith(`${this.uri}/`)) files.delete(key);
    }
    list() {
      const prefix = `${this.uri.replace(/\/$/, '')}/`;
      return [
        ...[...files.keys()].filter((key) => key.startsWith(prefix)).map((key) => new File(key)),
        ...[...dirs].filter((key) => key.startsWith(prefix)).map((key) => new Directory(key)),
      ];
    }
  }
  return { File, Directory, Paths: { document: '/doc', cache: '/cache' } };
});

function record(ts: number, message = 'ok') {
  return { v: 1 as const, ts, kind: 'log' as const, level: 'info' as const, name: 'test.event', message };
}

describe('bounded JSONL diagnostics store', () => {
  beforeEach(() => {
    const root = new Directory('/doc', 'diag');
    if (root.exists) root.delete();
    root.create();
  });

  it('persists buffered records and recovers them after a restart', async () => {
    const root = new Directory('/doc', 'diag');
    const store = new DiagnosticsStore(() => 1_000, root);
    store.append(record(1_000, 'first'));
    store.append(record(1_001, 'second'));
    await store.flush();

    const restarted = new DiagnosticsStore(() => 1_002, root);
    const records = await restarted.read(10);
    expect(records.map((entry) => entry.message)).toEqual(['second', 'first']);
  });

  it('skips corrupt lines and keeps reading the valid records', async () => {
    const root = new Directory('/doc', 'diag');
    const file = new File(root, 'segment-1000-0.jsonl');
    file.create();
    file.write(`${JSON.stringify(record(1_000, 'valid'))}\n{not json}\n`);
    const store = new DiagnosticsStore(() => 1_000, root);
    const records = await store.read(10);
    expect(records).toHaveLength(1);
    expect(records[0].message).toBe('valid');
  });

  it('prunes records older than the retention window', async () => {
    const root = new Directory('/doc', 'diag');
    const old = new File(root, `segment-${Date.now() - (DIAGNOSTICS_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000}-0.jsonl`);
    old.create();
    old.write(`${JSON.stringify(record(1))}\n`);
    const store = new DiagnosticsStore(() => Date.now(), root);
    await store.prune();
    expect(await store.read(10)).toEqual([]);
  });

  it('keeps total storage bounded even when fresh segments exceed the cap', async () => {
    const root = new Directory('/doc', 'diag');
    const store = new DiagnosticsStore(() => Date.now(), root);
    const big = 'x'.repeat(1024 * 1024);
    for (let index = 0; index < 12; index += 1) {
      const file = new File(root, `segment-${Date.now() + index}-0.jsonl`);
      file.create();
      file.write(big);
    }
    await store.prune();
    expect((await store.usage()).bytes).toBeLessThanOrEqual(DIAGNOSTICS_MAX_BYTES);
  });

  it('clears all local history', async () => {
    const root = new Directory('/doc', 'diag');
    const store = new DiagnosticsStore(() => 1_000, root);
    store.append(record(1_000));
    await store.flush();
    expect((await store.read(10)).length).toBe(1);
    await store.clear();
    expect(await store.read(10)).toEqual([]);
  });
});
