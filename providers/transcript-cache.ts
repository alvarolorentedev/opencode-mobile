import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { SessionMessageRecord } from '@/lib/opencode/format';
import { transcriptCacheKey } from '@/lib/storage-keys';
import { loadPersistedValue, type PersistenceStorage } from '@/providers/persistence-hydration';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 24;
const MAX_CHARS = 200_000;

type TranscriptCacheStorage = PersistenceStorage & Pick<typeof AsyncStorage, 'setItem'>;
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

function parseEnvelope(raw: string): SessionMessageRecord[] {
  const value = TranscriptEnvelopeSchema.parse(JSON.parse(raw));
  if (Date.now() - value.cachedAt > CACHE_TTL_MS) throw new Error('Transcript cache expired.');
  return value.records as SessionMessageRecord[];
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
  await loadPersistedValue(storage, transcriptCacheKey(connectionScope, projectPath, sessionId), parseEnvelope, (records) => {
    if (isCurrent()) apply(records);
  });
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
  await storage.setItem(transcriptCacheKey(connectionScope, projectPath, sessionId), JSON.stringify(envelope)).catch(() => undefined);
}

export async function migrateTranscriptCaches(previousScope: string, nextScope: string) {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = 'opencode-mobile.transcript.';
  for (const key of keys.filter((entry) => entry.startsWith(`${prefix}${previousScope}.`))) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    try { parseEnvelope(raw); } catch { continue; }
    await AsyncStorage.setItem(`${prefix}${nextScope}.${key.slice(`${prefix}${previousScope}.`.length)}`, raw);
  }
}
