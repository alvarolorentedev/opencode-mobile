import { getConnectionScope } from '@/shared/contracts/connection-scope';
import type { ConnectionRecord } from '@/shared/contracts/workspace';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import type { QueryIdentity } from '@/shared/server-data/keys';

export function createServerQueryClient() {
  return new QueryClient({ defaultOptions: {
    queries: { retry: false, staleTime: 60_000, gcTime: 300_000, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false },
    mutations: { retry: false },
  } });
}
const ForegroundContext = createContext(true);
const subscribeFocus = (listener: () => void) => focusManager.subscribe(listener);
export const isServerQueryForeground = () => focusManager.isFocused() && (Platform.OS === 'web' || AppState.currentState === 'active');
export function ServerDataProvider({ children }: PropsWithChildren) {
  const [client] = useState(createServerQueryClient);
  const foreground = useSyncExternalStore(subscribeFocus, isServerQueryForeground, () => true);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    focusManager.setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => { focusManager.setFocused(state === 'active'); });
    return () => subscription.remove();
  }, []);
  return <QueryClientProvider client={client}><ForegroundContext.Provider value={foreground}>{children}</ForegroundContext.Provider></QueryClientProvider>;
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
export function ServerDataActivity({ active, children }: PropsWithChildren<{ active: boolean }>) {
  const parent = useContext(ActivityContext);
  return <ActivityContext.Provider value={parent && active}>{children}</ActivityContext.Provider>;
}
export function useQueryForeground() { return useContext(ForegroundContext); }
export function useQueryActivity() {
  const active = useContext(ActivityContext);
  const foreground = useContext(ForegroundContext);
  return active && foreground;
}
export function setServerQueryOnline(online: boolean) { onlineManager.setOnline(online); }
