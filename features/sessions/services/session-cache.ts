import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';
import { sessionsCacheKey, sessionStatusesCacheKey } from '@/shared/storage/keys';
import { loadPersistedValue, type PersistenceStorage } from '@/shared/storage/persistence-hydration';

type SessionCacheStorage = PersistenceStorage & Pick<typeof AsyncStorage, 'setItem'>;

export async function migrateConnectionSessionCaches(previousScope: string, nextScope: string) {
  const keys = await AsyncStorage.getAllKeys();
  for (const prefix of ['opencode-mobile.sessions.', 'opencode-mobile.session-statuses.']) {
    for (const key of keys.filter((entry) => entry.startsWith(`${prefix}${previousScope}.`))) {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      try { if (prefix.includes('session-statuses')) parseCachedStatuses(raw); else parseCachedSessions(raw); } catch { continue; }
      await AsyncStorage.setItem(`${prefix}${nextScope}.${key.slice(`${prefix}${previousScope}.`.length)}`, raw);
    }
  }
}

// Smallest set of session fields the project needs to paint the chat list
// before the server answers. SDK/server Session objects are mapped down to
// this at write time, so a future upstream field is never persisted by
// accident, and sensitive or large fields (share URLs, metadata, tokens,
// revert diffs) are never written to plain AsyncStorage.
type CachedSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  parentID?: string;
};

// Only the status discriminant is rendered; retry details are dropped.
type CachedSessionStatus = { type: 'idle' | 'busy' | 'retry' };

export const SESSION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedSessionsEnvelope = { cachedAt: number; sessions: CachedSession[] };
type CachedStatusesEnvelope = { cachedAt: number; statuses: Record<string, CachedSessionStatus> };

const CachedSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  parentID: z.string().optional(),
});
const CachedStatusSchema = z.object({ type: z.enum(['idle', 'busy', 'retry']) });
const CachedSessionsEnvelopeSchema = z.object({
  cachedAt: z.number().finite(),
  sessions: z.array(CachedSessionSchema),
});
const CachedStatusesEnvelopeSchema = z.object({
  cachedAt: z.number().finite(),
  statuses: z.record(z.string(), CachedStatusSchema),
});

// Expired, legacy (pre-envelope), and future-shaped payloads all fail here,
// which makes loadPersistedValue remove the key. Dropping a regenerable cache
// is the safe fallback: the next confirmed fetch republishes it.
function parseCachedSessions(raw: string): CachedSession[] {
  const value = CachedSessionsEnvelopeSchema.parse(JSON.parse(raw));
  if (Date.now() - value.cachedAt > SESSION_CACHE_TTL_MS) throw new Error('Session cache expired.');
  return value.sessions;
}

function parseCachedStatuses(raw: string): Record<string, CachedSessionStatus> {
  const value = CachedStatusesEnvelopeSchema.parse(JSON.parse(raw));
  if (Date.now() - value.cachedAt > SESSION_CACHE_TTL_MS) throw new Error('Session status cache expired.');
  return value.statuses;
}

export function toCachedSession(session: Session): CachedSession {
  const created = session.time?.created;
  const updated = session.time?.updated;
  return {
    id: session.id,
    title: typeof session.title === 'string' ? session.title : '',
    createdAt: typeof created === 'number' && Number.isFinite(created) ? created : 0,
    updatedAt: typeof updated === 'number' && Number.isFinite(updated) ? updated : 0,
    ...(typeof session.parentID === 'string' ? { parentID: session.parentID } : {}),
  };
}

// Rebuilds the in-memory Session shape. Fields outside the DTO are absent
// (matching the v2 adapter, which already omits them) and are reconciled by
// the next server fetch.
function toSessionFromCache(cached: CachedSession): Session {
  return {
    id: cached.id,
    title: cached.title,
    time: { created: cached.createdAt, updated: cached.updatedAt },
    ...(cached.parentID ? { parentID: cached.parentID } : {}),
  };
}

function normalizeStatusType(type: SessionStatus['type'] | undefined): CachedSessionStatus['type'] {
  return type === 'busy' || type === 'retry' ? type : 'idle';
}

/**
 * Hydrates the cached session list and status map for one
 * connection + project pair.
 *
 * Cached values are written only after a confirmed server fetch for that pair,
 * so an empty cached list always means "the server reported no sessions",
 * never "the list was cleared mid-switch". Keys embed the password-free
 * connection scope, so two servers exposing the same project path never share
 * entries. Expired or malformed values are removed; transient storage read
 * failures leave the key untouched (see `loadPersistedValue`), and values read
 * after the user switched connection or project are not applied.
 */
export async function hydrateSessionCache(
  connectionScope: string,
  projectPath: string,
  applySessions: (sessions: Session[]) => void,
  applyStatuses: (statuses: Record<string, CachedSessionStatus>) => void,
  isCurrent: () => boolean,
  storage: SessionCacheStorage = AsyncStorage,
) {
  await loadPersistedValue(storage, sessionsCacheKey(connectionScope, projectPath), parseCachedSessions, (sessions) => {
    if (isCurrent()) {
      applySessions(sessions.map(toSessionFromCache));
    }
  });
  await loadPersistedValue(storage, sessionStatusesCacheKey(connectionScope, projectPath), parseCachedStatuses, (statuses) => {
    if (isCurrent()) {
      applyStatuses(statuses);
    }
  });
}

/**
 * Persists a confirmed fetch result for one connection + project pair. SDK
 * Session and SessionStatus objects are mapped to their persisted DTOs first.
 * Empty lists are valid: they overwrite any stale cache so a deleted last
 * session does not resurrect on the next launch. Write failures are ignored;
 * the next refresh rewrites.
 */
export async function persistSessionCache(
  connectionScope: string,
  projectPath: string,
  sessions: Session[],
  statuses: Record<string, SessionStatus>,
  storage: SessionCacheStorage = AsyncStorage,
) {
  const cachedAt = Date.now();
  const sessionsEnvelope: CachedSessionsEnvelope = { cachedAt, sessions: sessions.map(toCachedSession) };
  const statusesEnvelope: CachedStatusesEnvelope = {
    cachedAt,
    statuses: Object.fromEntries(
      Object.entries(statuses).map(([sessionId, status]) => [sessionId, { type: normalizeStatusType(status?.type) }]),
    ),
  };
  await storage.setItem(sessionsCacheKey(connectionScope, projectPath), JSON.stringify(sessionsEnvelope)).catch(() => undefined);
  await storage.setItem(sessionStatusesCacheKey(connectionScope, projectPath), JSON.stringify(statusesEnvelope)).catch(() => undefined);
}
