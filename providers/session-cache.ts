import AsyncStorage from '@react-native-async-storage/async-storage';

import { sessionsCacheKey, sessionStatusesCacheKey } from '@/lib/storage-keys';
import { loadPersistedValue, type PersistenceStorage } from '@/providers/persistence-hydration';

type SessionCacheStorage = PersistenceStorage & Pick<typeof AsyncStorage, 'setItem'>;
type CachedSession = { id: string; [key: string]: unknown };
type CachedSessionStatus = { type?: string; [key: string]: unknown };

function parseCachedSessions(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((session) => typeof session === 'object' && session !== null && typeof (session as CachedSession).id === 'string')) {
    throw new Error('Expected a list of sessions.');
  }
  return parsed as CachedSession[];
}

function parseCachedSessionStatuses(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected a session status map.');
  }
  for (const status of Object.values(parsed as Record<string, unknown>)) {
    if (typeof status !== 'object' || status === null) {
      throw new Error('Expected a session status map.');
    }
  }
  return parsed as Record<string, CachedSessionStatus>;
}

/**
 * Hydrates the cached session list and status map for `projectPath`.
 *
 * Values are written by `persistSessionCache` only after a confirmed server
 * fetch for that project, so an empty cached list always means "the server
 * reported no sessions", never "the list was cleared mid-switch". Malformed
 * values are removed; transient storage read failures leave the key untouched
 * (see `loadPersistedValue`).
 */
export async function hydrateSessionCache(
  projectPath: string,
  applySessions: (sessions: CachedSession[]) => void,
  applyStatuses: (statuses: Record<string, CachedSessionStatus>) => void,
  isCurrent: () => boolean,
  storage: SessionCacheStorage = AsyncStorage,
) {
  await loadPersistedValue(storage, sessionsCacheKey(projectPath), parseCachedSessions, (sessions) => {
    if (isCurrent()) {
      applySessions(sessions);
    }
  });
  await loadPersistedValue(storage, sessionStatusesCacheKey(projectPath), parseCachedSessionStatuses, (statuses) => {
    if (isCurrent()) {
      applyStatuses(statuses);
    }
  });
}

/**
 * Persists a confirmed fetch result for `projectPath`. Empty lists are valid:
 * they overwrite any stale cache so a deleted last session does not resurrect
 * on the next launch. Write failures are ignored; the next refresh rewrites.
 */
export async function persistSessionCache(
  projectPath: string,
  sessions: CachedSession[],
  statuses: Record<string, CachedSessionStatus>,
  storage: SessionCacheStorage = AsyncStorage,
) {
  await storage.setItem(sessionsCacheKey(projectPath), JSON.stringify(sessions)).catch(() => undefined);
  await storage.setItem(sessionStatusesCacheKey(projectPath), JSON.stringify(statuses)).catch(() => undefined);
}
