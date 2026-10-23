import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SessionMessageRecord } from '@/lib/opencode/format';
import { transcriptCacheKey } from '@/lib/storage-keys';
import { loadPersistedValue, type PersistenceStorage } from '@/providers/persistence-hydration';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 24;
const MAX_CHARS = 200_000;

type TranscriptCacheStorage = PersistenceStorage & Pick<typeof AsyncStorage, 'setItem'>;
type Envelope = { cachedAt: number; records: SessionMessageRecord[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validMessage(value: unknown): value is SessionMessageRecord {
  if (!isRecord(value) || !isRecord(value.info)) return false;
  if (typeof value.info.id !== 'string' || value.info.id.length === 0) return false;
  if (value.info.role !== 'user' && value.info.role !== 'assistant') return false;
  return Array.isArray(value.parts) && value.parts.every(isRecord);
}

function parseEnvelope(raw: string): SessionMessageRecord[] {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error('Expected a transcript cache envelope.');
  if (typeof value.cachedAt !== 'number' || !Number.isFinite(value.cachedAt)) throw new Error('Expected a cache timestamp.');
  if (Date.now() - value.cachedAt > CACHE_TTL_MS) throw new Error('Transcript cache expired.');
  if (!Array.isArray(value.records) || !value.records.every(validMessage)) throw new Error('Expected cached transcript records.');
  return value.records;
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
