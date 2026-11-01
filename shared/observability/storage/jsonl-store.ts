import { Directory, File, Paths } from 'expo-file-system';

import { sanitizeRecord } from '@/shared/observability/sanitize';
import type { DiagnosticRecord, StorageSnapshot } from '@/shared/observability/types';

export const DIAGNOSTICS_DIRECTORY = 'opencode-diagnostics';
export const DIAGNOSTICS_RETENTION_DAYS = 7;
export const DIAGNOSTICS_MAX_BYTES = 10 * 1024 * 1024;
export const DIAGNOSTICS_SEGMENT_BYTES = 512 * 1024;
export const DIAGNOSTICS_BUFFER_RECORDS = 500;
export const DIAGNOSTICS_BUFFER_BYTES = 256 * 1024;
export const DIAGNOSTICS_FLUSH_MS = 2000;

const SEGMENT_PATTERN = /^segment-(\d+)-(\d+)\.jsonl$/;
const MAX_READ_BYTES = 2 * 1024 * 1024;

type Clock = () => number;

function segmentTimestamp(name: string) {
  const match = SEGMENT_PATTERN.exec(name);
  return match ? Number(match[1]) : 0;
}

function isSegment(name: string) {
  return SEGMENT_PATTERN.test(name);
}

export class DiagnosticsStore {
  private rootOverride?: Directory;
  private current?: File;
  private buffer: string[] = [];
  private bufferedBytes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private flushChain: Promise<void> = Promise.resolve();
  private initialized?: Promise<void>;
  private sequence = 0;
  private corruptFiles = 0;

  constructor(private readonly clock: Clock = Date.now, root?: Directory) {
    this.rootOverride = root;
  }

  // Constructing an Expo FileSystem object is only valid in the app runtime;
  // defer it so web/SSR module evaluation never touches a platform path.
  private get root() {
    this.rootOverride ??= new Directory(Paths.document, DIAGNOSTICS_DIRECTORY);
    return this.rootOverride;
  }

  initialize() {
    this.initialized ??= this.prepare();
    return this.initialized;
  }

  private async prepare() {
    try {
      if (!this.root.exists) this.root.create({ intermediates: true });
      await this.prune();
      this.current = this.newSegment();
    } catch {
      // Diagnostics are best-effort. A read-only or unavailable filesystem must
      // never prevent startup or affect business logic.
      this.current = undefined;
    }
  }

  private newSegment() {
    const file = new File(this.root, `segment-${this.clock()}-${this.sequence++}.jsonl`);
    if (!file.exists) file.create({ intermediates: true });
    return file;
  }

  private async ensureCurrent() {
    await this.initialize();
    if (!this.current) {
      try {
        this.current = this.newSegment();
      } catch {
        return undefined;
      }
    }
    return this.current;
  }

  append(record: DiagnosticRecord) {
    if (this.closed) return;
    const safe = sanitizeRecord(record);
    const line = `${JSON.stringify(safe)}\n`;
    this.buffer.push(line);
    this.bufferedBytes += line.length;
    if (this.buffer.length >= DIAGNOSTICS_BUFFER_RECORDS || this.bufferedBytes >= DIAGNOSTICS_BUFFER_BYTES) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, DIAGNOSTICS_FLUSH_MS);
    }
  }

  // Fatal paths cannot wait for the async buffer. The existing synchronous
  // last-error file remains the crash authority; this method is only used when
  // a caller explicitly needs an immediate append.
  appendSync(record: DiagnosticRecord) {
    if (this.closed) return;
    try {
      const file = this.current ?? this.newSegment();
      file.write(`${JSON.stringify(sanitizeRecord(record))}\n`, { append: true });
    } catch {
      // Best effort.
    }
  }

  flush() {
    this.flushChain = this.flushChain.catch(() => undefined).then(() => this.flushNow());
    return this.flushChain;
  }

  private async flushNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.buffer.length === 0) return;
    const payload = this.buffer.join('');
    this.buffer = [];
    this.bufferedBytes = 0;
    const file = await this.ensureCurrent();
    if (!file) return;
    try {
      await file.write(payload, { append: true });
      if ((file.size ?? 0) >= DIAGNOSTICS_SEGMENT_BYTES) {
        this.current = this.newSegment();
        await this.prune();
      }
    } catch {
      // Do not re-queue an unbounded payload after a persistent write failure;
      // the next interval starts fresh and storage stays bounded.
      this.corruptFiles += 1;
    }
  }

  async prune() {
    try {
      if (!this.root.exists) return;
      const files = this.root.list().filter((entry): entry is File => entry instanceof File && isSegment(entry.name));
      const entries = files.map((file) => ({ file, at: segmentTimestamp(file.name), size: file.size ?? 0 }));
      entries.sort((a, b) => a.at - b.at);
      const cutoff = this.clock() - DIAGNOSTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      let total = entries.reduce((sum, entry) => sum + entry.size, 0);
      for (const entry of entries) {
        if (entry.at >= cutoff && total <= DIAGNOSTICS_MAX_BYTES) continue;
        try {
          entry.file.delete();
          total -= entry.size;
        } catch {
          this.corruptFiles += 1;
        }
      }
    } catch {
      this.corruptFiles += 1;
    }
  }

  async usage(): Promise<StorageSnapshot> {
    try {
      await this.initialize();
      const files = this.root.list().filter((entry): entry is File => entry instanceof File && isSegment(entry.name));
      const sizes = files.map((file) => ({ at: segmentTimestamp(file.name), size: file.size ?? 0 }));
      return {
        bytes: sizes.reduce((sum, entry) => sum + entry.size, 0),
        files: sizes.length,
        oldestAt: sizes.length ? Math.min(...sizes.map((entry) => entry.at)) : undefined,
        retentionDays: DIAGNOSTICS_RETENTION_DAYS,
        maxBytes: DIAGNOSTICS_MAX_BYTES,
        corruptFiles: this.corruptFiles,
      };
    } catch {
      return {
        bytes: 0,
        files: 0,
        retentionDays: DIAGNOSTICS_RETENTION_DAYS,
        maxBytes: DIAGNOSTICS_MAX_BYTES,
        corruptFiles: this.corruptFiles + 1,
      };
    }
  }

  async read(limit = 200, filter?: (record: DiagnosticRecord) => boolean) {
    try {
      await this.initialize();
      if (!this.root.exists) return [] as DiagnosticRecord[];
      const files = this.root.list()
        .filter((entry): entry is File => entry instanceof File && isSegment(entry.name))
        .sort((a, b) => segmentTimestamp(b.name) - segmentTimestamp(a.name));
      const records: DiagnosticRecord[] = [];
      let bytes = 0;
      for (const file of files) {
        if (records.length >= limit || bytes >= MAX_READ_BYTES) break;
        let text = '';
        try {
          text = await file.text();
        } catch {
          this.corruptFiles += 1;
          continue;
        }
        bytes += text.length;
        const lines = text.split('\n');
        for (let index = lines.length - 1; index >= 0 && records.length < limit; index -= 1) {
          const line = lines[index].trim();
          if (!line) continue;
          try {
            const parsed = JSON.parse(line) as DiagnosticRecord;
            if (parsed && parsed.v === 1 && typeof parsed.ts === 'number' && typeof parsed.name === 'string') {
              const safe = sanitizeRecord(parsed);
              if (!filter || filter(safe)) records.push(safe);
            }
          } catch {
            // A corrupt line is skipped; the rest of the segment remains usable.
          }
        }
      }
      return records.sort((a, b) => b.ts - a.ts).slice(0, limit);
    } catch {
      return [] as DiagnosticRecord[];
    }
  }

  async clear() {
    await this.flush();
    try {
      if (this.root.exists) this.root.delete();
      this.root.create({ intermediates: true });
      this.current = this.newSegment();
    } catch {
      this.current = undefined;
    }
    this.corruptFiles = 0;
  }

  async close() {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.flush();
  }

  private closed = false;
}

export type { StorageSnapshot };
