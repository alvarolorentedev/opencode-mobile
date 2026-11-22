import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { SessionMessageRecord } from '@/shared/presentation/format';
import { compactTranscriptSnapshot, TRANSCRIPT_SNAPSHOT_MAX_AGE } from '@/shared/server-data/transcript-snapshots';
import { transcriptCacheKey } from '@/shared/storage/keys';
import { loadPersistedValue, type PersistenceStorage } from '@/shared/storage/persistence-hydration';

const MAX_CHARS = 200_000;
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
  if (Date.now() - value.cachedAt > TRANSCRIPT_SNAPSHOT_MAX_AGE) throw new Error('Transcript cache expired.');
  return value as Envelope;
}

// Upgrade path for installs made before per-session Query persistence.
export async function hydrateTranscriptCache(
  connectionScope: string,
  projectPath: string,
  sessionId: string,
  apply: (records: SessionMessageRecord[]) => void,
  isCurrent: () => boolean,
  storage: PersistenceStorage = AsyncStorage,
) {
  if (!connectionScope || !projectPath || !sessionId) return;
  await loadPersistedValue(storage, transcriptCacheKey(connectionScope, projectPath, sessionId), (raw) =>
    compactTranscriptSnapshot([{ records: parseEnvelope(raw).records }], MAX_CHARS, sessionId).records, (records) => {
    if (isCurrent()) apply(records);
  });
}

export async function migrateTranscriptCaches(previousScope: string, nextScope: string, storage: TranscriptCacheStorage = AsyncStorage) {
  const keys = await storage.getAllKeys();
  const prefix = `${CACHE_PREFIX}${previousScope}.`;
  for (const key of keys.filter((entry) => entry.startsWith(prefix))) {
    const raw = await storage.getItem(key);
    if (!raw || raw.length > MAX_CHARS) continue;
    let envelope: Envelope;
    try { envelope = parseEnvelope(raw); } catch { continue; }
    const target = `${CACHE_PREFIX}${nextScope}.${key.slice(prefix.length)}`;
    const existing = await storage.getItem(target);
    if (existing) {
      try {
        if (parseEnvelope(existing).cachedAt >= envelope.cachedAt) continue;
      } catch { /* Replace an expired or malformed destination. */ }
    }
    const { records } = compactTranscriptSnapshot([{ records: envelope.records }]);
    if (records.length) await storage.setItem(target, JSON.stringify({ cachedAt: envelope.cachedAt, records }));
  }
}
