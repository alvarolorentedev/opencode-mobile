import { getConnectionScope } from '@/shared/contracts/connection-scope';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import type { QueryIdentity } from '@/shared/server-data/keys';
import { createServerQueryClient } from '@/shared/server-data/query-client';
import { createServerQueryPersister, SERVER_QUERY_CACHE_MAX_AGE, shouldPersistQuery } from '@/shared/server-data/persistence';

export { createServerQueryClient };
const ForegroundContext = createContext(true);
const subscribeFocus = (listener: () => void) => focusManager.subscribe(listener);
export const isServerQueryForeground = () => focusManager.isFocused() && (Platform.OS === 'web' || AppState.currentState === 'active');
export function ServerDataProvider({ children, client: provided }: PropsWithChildren<{ client?: QueryClient }>) {
  const [fallback] = useState(createServerQueryClient);
  const client = provided ?? fallback;
  const [persister] = useState(createServerQueryPersister);
  const [restored, setRestored] = useState(false);
  const foreground = useSyncExternalStore(subscribeFocus, isServerQueryForeground, () => true);
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
      <ForegroundContext.Provider value={foreground}>
        {restored ? children : null}
      </ForegroundContext.Provider>
    </PersistQueryClientProvider>
  );
}
const ScopeContext = createContext<QueryIdentity | null>(null);
const ActivityContext = createContext(false);
export function ServerDataScope({ connection, active, children }: PropsWithChildren<{ connection: ConnectionRecord; active: boolean }>) {
  const connectionScope = getConnectionScope(connection.settings);
  const value = useMemo(() => ({ connectionId: connection.id, connectionScope, authRevision: connection.authRevision ?? 0 }), [connection.id, connectionScope, connection.authRevision]);
  return <ScopeContext.Provider value={value}><ActivityContext.Provider value={active && connection.enabled}>{children}</ActivityContext.Provider></ScopeContext.Provider>;
}
export function useQueryIdentity() {
  const identity = useContext(ScopeContext);
  if (!identity) throw new Error('Server data requires a workspace scope.');
  return identity;
}
export function useQueryForeground() { return useContext(ForegroundContext); }
export function useQueryActivity() {
  const active = useContext(ActivityContext);
  const foreground = useContext(ForegroundContext);
  return active && foreground;
}
export function setServerQueryOnline(online: boolean) { onlineManager.setOnline(online); }
