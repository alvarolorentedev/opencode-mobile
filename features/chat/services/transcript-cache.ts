import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import { transcriptCacheKey } from '@/shared/storage/keys';
import { loadPersistedValue, type PersistenceStorage } from '@/shared/storage/persistence-hydration';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 24;
const MAX_CHARS = 200_000;
// A UTF-8 value can be up to three bytes per UTF-16 code unit.
const MAX_CACHED_SESSIONS = 64;
const CACHE_PREFIX = 'opencode-mobile.transcript.';

type TranscriptCacheStorage = PersistenceStorage & Pick<typeof AsyncStorage, 'getAllKeys' | 'setItem'>;
type Envelope = { cachedAt: number; records: SessionMessageRecord[] };

const CachedMessageSchema = z.object({
  info: z.object({
    id: z.string().min(1),
    role: z.enum(['user', 'assistant']),
  }).passthrough(),
  parts: z.array(z.record(z.string(), z.unknown())),
}).passthrough();
const TranscriptEnvelopeSchema = z.object({
  cachedAt: z.number().finite(),
  records: z.array(CachedMessageSchema),
});

function parseEnvelope(raw: string): Envelope {
  const value = TranscriptEnvelopeSchema.parse(JSON.parse(raw));
  if (Date.now() - value.cachedAt > CACHE_TTL_MS) throw new Error('Transcript cache expired.');
  return value as Envelope;
}

function bounded(records: SessionMessageRecord[]) {
  const tail = records.slice(-MAX_RECORDS);
  while (tail.length > 0) {
    const serialized = JSON.stringify({ cachedAt: Date.now(), records: tail });
    if (serialized.length <= MAX_CHARS) return tail;
    tail.shift();
  }
  return [];
}

export async function hydrateTranscriptCache(
  connectionScope: string,
  projectPath: string,
  sessionId: string,
  apply: (records: SessionMessageRecord[]) => void,
  isCurrent: () => boolean,
  storage: TranscriptCacheStorage = AsyncStorage,
) {
  if (!connectionScope || !projectPath || !sessionId) return;
  await loadPersistedValue(storage, transcriptCacheKey(connectionScope, projectPath, sessionId), (raw) => parseEnvelope(raw).records, (records) => {
    if (isCurrent()) apply(records);
  });
}

const cacheIndexes = new WeakMap<TranscriptCacheStorage, Map<string, number>>();
let cacheWrites = Promise.resolve();

async function writeTranscript(storage: TranscriptCacheStorage, key: string, raw: string, cachedAt: number) {
  const write = cacheWrites.then(async () => {
    let index = cacheIndexes.get(storage);
    if (!index) {
      index = new Map();
      for (const entry of (await storage.getAllKeys()).filter((value) => value.startsWith(CACHE_PREFIX))) {
        const saved = await storage.getItem(entry);
        if (saved === null) continue;
        let timestamp: unknown;
        try { timestamp = JSON.parse(saved)?.cachedAt; } catch { /* Invalid snapshots can be evicted. */ }
        index.set(entry, typeof timestamp === 'number' && Number.isFinite(timestamp) && saved.length <= MAX_CHARS ? timestamp : 0);
      }
      cacheIndexes.set(storage, index);
    }
    if ((index.get(key) ?? 0) > cachedAt) return;
    const cutoff = Date.now() - CACHE_TTL_MS;
    const remaining = [...index].filter(([entry]) => entry !== key).sort((left, right) => left[1] - right[1]);
    while (remaining.length && (remaining.length >= MAX_CACHED_SESSIONS || remaining[0][1] < cutoff)) {
      const [evicted] = remaining.shift()!;
      await storage.removeItem(evicted);
      index.delete(evicted);
    }
    await storage.setItem(key, raw);
    index.set(key, cachedAt);
  });
  cacheWrites = write.catch(() => undefined);
  return write;
}

export async function persistTranscriptCache(
  connectionScope: string,
  projectPath: string,
  sessionId: string,
  records: SessionMessageRecord[],
  storage: TranscriptCacheStorage = AsyncStorage,
) {
  if (!connectionScope || !projectPath || !sessionId || records.length === 0) return;
  const tail = bounded(records);
  if (tail.length === 0) return;
  const envelope: Envelope = { cachedAt: Date.now(), records: tail };
  await writeTranscript(storage, transcriptCacheKey(connectionScope, projectPath, sessionId), JSON.stringify(envelope), envelope.cachedAt).catch(() => undefined);
}

export async function migrateTranscriptCaches(previousScope: string, nextScope: string) {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = CACHE_PREFIX;
  for (const key of keys.filter((entry) => entry.startsWith(`${prefix}${previousScope}.`))) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    if (raw.length > MAX_CHARS) continue;
    let envelope: Envelope;
    try { envelope = parseEnvelope(raw); } catch { continue; }
    await writeTranscript(AsyncStorage, `${prefix}${nextScope}.${key.slice(`${prefix}${previousScope}.`.length)}`, raw, envelope.cachedAt);
  }
}
