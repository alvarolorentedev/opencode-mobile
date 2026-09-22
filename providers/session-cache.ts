import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Session, SessionStatus } from '@/lib/opencode/types';
import { sessionsCacheKey, sessionStatusesCacheKey } from '@/lib/storage-keys';
import { loadPersistedValue, type PersistenceStorage } from '@/providers/persistence-hydration';

type SessionCacheStorage = PersistenceStorage & Pick<typeof AsyncStorage, 'setItem'>;

// Smallest set of session fields the workspace needs to paint the chat list
// before the server answers. SDK/server Session objects are mapped down to
// this at write time, so a future upstream field is never persisted by
// accident, and sensitive or large fields (share URLs, metadata, tokens,
// revert diffs) are never written to plain AsyncStorage.
export type CachedSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  parentID?: string;
};

// Only the status discriminant is rendered; retry details are dropped.
export type CachedSessionStatus = { type: 'idle' | 'busy' | 'retry' };

export const SESSION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedSessionsEnvelope = { cachedAt: number; sessions: CachedSession[] };
type CachedStatusesEnvelope = { cachedAt: number; statuses: Record<string, CachedSessionStatus> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCachedSession(value: unknown): value is CachedSession {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.title !== 'string') return false;
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false;
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return false;
  if (value.parentID !== undefined && typeof value.parentID !== 'string') return false;
  return true;
}

function isValidCachedStatus(value: unknown): value is CachedSessionStatus {
  return isRecord(value) && (value.type === 'idle' || value.type === 'busy' || value.type === 'retry');
}

// Expired, legacy (pre-envelope), and future-shaped payloads all fail here,
// which makes loadPersistedValue remove the key. Dropping a regenerable cache
// is the safe fallback: the next confirmed fetch republishes it.
function parseCachedSessions(raw: string): CachedSession[] {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error('Expected a session cache envelope.');
  const cachedAt = value.cachedAt;
  if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) throw new Error('Expected a cache timestamp.');
  if (Date.now() - cachedAt > SESSION_CACHE_TTL_MS) throw new Error('Session cache expired.');
  const sessions = value.sessions;
  if (!Array.isArray(sessions) || !sessions.every(isValidCachedSession)) {
    throw new Error('Expected a list of cached sessions.');
  }
  return sessions;
}

function parseCachedStatuses(raw: string): Record<string, CachedSessionStatus> {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error('Expected a session status cache envelope.');
  const cachedAt = value.cachedAt;
  if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) throw new Error('Expected a cache timestamp.');
  if (Date.now() - cachedAt > SESSION_CACHE_TTL_MS) throw new Error('Session status cache expired.');
  const statuses = value.statuses;
  if (!isRecord(statuses) || !Object.values(statuses).every(isValidCachedStatus)) {
    throw new Error('Expected a session status map.');
  }
  return statuses as Record<string, CachedSessionStatus>;
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
export function toSessionFromCache(cached: CachedSession): Session {
  return {
    id: cached.id,
    title: cached.title,
    time: { created: cached.createdAt, updated: cached.updatedAt },
    ...(cached.parentID ? { parentID: cached.parentID } : {}),
  } as unknown as Session;
}

function normalizeStatusType(type: SessionStatus['type'] | undefined): CachedSessionStatus['type'] {
  return type === 'busy' || type === 'retry' ? type : 'idle';
}

/**
 * Hydrates the cached session list and status map for `projectPath`.
 *
 * Cached values are written only after a confirmed server fetch for that
 * project, so an empty cached list always means "the server reported no
 * sessions", never "the list was cleared mid-switch". Expired or malformed
 * values are removed; transient storage read failures leave the key untouched
 * (see `loadPersistedValue`), and values read after the user switched away are
 * not applied.
 */
export async function hydrateSessionCache(
  projectPath: string,
  applySessions: (sessions: Session[]) => void,
  applyStatuses: (statuses: Record<string, CachedSessionStatus>) => void,
  isCurrent: () => boolean,
  storage: SessionCacheStorage = AsyncStorage,
) {
  await loadPersistedValue(storage, sessionsCacheKey(projectPath), parseCachedSessions, (sessions) => {
    if (isCurrent()) {
      applySessions(sessions.map(toSessionFromCache));
    }
  });
  await loadPersistedValue(storage, sessionStatusesCacheKey(projectPath), parseCachedStatuses, (statuses) => {
    if (isCurrent()) {
      applyStatuses(statuses);
    }
  });
}

/**
 * Persists a confirmed fetch result for `projectPath`. SDK Session and
 * SessionStatus objects are mapped to their persisted DTOs first. Empty lists
 * are valid: they overwrite any stale cache so a deleted last session does not
 * resurrect on the next launch. Write failures are ignored; the next refresh
 * rewrites.
 */
export async function persistSessionCache(
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
  await storage.setItem(sessionsCacheKey(projectPath), JSON.stringify(sessionsEnvelope)).catch(() => undefined);
  await storage.setItem(sessionStatusesCacheKey(projectPath), JSON.stringify(statusesEnvelope)).catch(() => undefined);
}
