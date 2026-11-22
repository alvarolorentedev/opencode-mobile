import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';

import { isTranscriptQueryKey, projectPersistedServerData, TRANSCRIPT_SNAPSHOT_MAX_AGE } from './transcript-snapshots';

const SERVER_QUERY_CACHE_KEY = 'opencode-mobile.query-cache.v1';
export const SERVER_QUERY_CACHE_MAX_AGE = TRANSCRIPT_SNAPSHOT_MAX_AGE;

export function createServerQueryPersister(storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'> = AsyncStorage) {
  return createAsyncStoragePersister({
    storage,
    key: SERVER_QUERY_CACHE_KEY,
    throttleTime: 1000,
    serialize: (snapshot) => JSON.stringify(projectPersistedServerData(snapshot)),
    deserialize: (serialized) => projectPersistedServerData(JSON.parse(serialized)),
  });
}

// The persister projects transcript queries onto bounded, media-free tails.
// Diffs, todos and inbox are regenerated.
export function shouldPersistQuery(query: Query) {
  if (query.queryKey[0] !== 'opencode' || query.state.status !== 'success') return false;
  const resource = query.queryKey[5];
  if (resource === 'sessions') return true;
  if (resource === 'server' && query.queryKey[6] === 'projects') return true;
  return isTranscriptQueryKey(query.queryKey);
}
