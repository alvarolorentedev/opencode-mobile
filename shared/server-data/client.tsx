import { getConnectionScope } from '@/shared/contracts/connection-scope';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect, useMemo, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import type { QueryIdentity } from '@/shared/server-data/keys';
import { createServerQueryClient } from '@/shared/server-data/query-client';
import { createServerQueryPersister, SERVER_QUERY_CACHE_MAX_AGE, shouldPersistQuery } from '@/shared/server-data/persistence';

export { createServerQueryClient };
const subscribeFocus = (listener: () => void) => focusManager.subscribe(listener);
const foregroundOnServer = () => true;
export const isServerQueryForeground = () => focusManager.isFocused() && (Platform.OS === 'web' || AppState.currentState === 'active');
export function ServerDataProvider({ children, client: provided }: PropsWithChildren<{ client?: QueryClient }>) {
  const [client] = useState(() => provided ?? createServerQueryClient());
  const [persister] = useState(() => createServerQueryPersister());
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    focusManager.setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => { focusManager.setFocused(state === 'active'); });
    return () => subscription.remove();
  }, []);
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: SERVER_QUERY_CACHE_MAX_AGE,
        buster: 'v1',
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
      onSuccess={() => setRestored(true)}
      onError={() => setRestored(true)}
    >
      {restored ? children : null}
    </PersistQueryClientProvider>
  );
}
export function useConnectionQueryIdentity(connection: ConnectionRecord): QueryIdentity {
  const connectionScope = getConnectionScope(connection.settings);
  return useMemo(() => ({ connectionId: connection.id, connectionScope, authRevision: connection.authRevision ?? 0 }), [connection.id, connectionScope, connection.authRevision]);
}
export function useQueryForeground() {
  return useSyncExternalStore(subscribeFocus, isServerQueryForeground, foregroundOnServer);
}
export function setServerQueryOnline(online: boolean) { onlineManager.setOnline(online); }
