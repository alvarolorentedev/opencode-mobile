import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';

export const SERVER_QUERY_CACHE_KEY = 'opencode-mobile.query-cache.v1';
export const SERVER_QUERY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

export function createServerQueryPersister() {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: SERVER_QUERY_CACHE_KEY,
    throttleTime: 1000,
  });
}

// Persist only small server catalogs. Messages carry inline media and are
// covered by the scoped transcript cache; diffs, todos and inbox are regenerated.
export function shouldPersistQuery(query: Query) {
  if (query.queryKey[0] !== 'opencode' || query.state.status !== 'success') return false;
  const resource = query.queryKey[5];
  if (resource === 'sessions') return true;
  if (resource === 'server' && query.queryKey[6] === 'projects') return true;
  return false;
}
