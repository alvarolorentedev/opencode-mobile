import { listSavedPermissionRules, removeSavedPermissionRule, withReadSignal, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { useQueryActivity, useQueryIdentity } from '@/shared/server-data/client';
import { connectionQueryKey } from '@/shared/server-data/keys';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
const EMPTY: never[] = [];
export function usePermissionRulesState({ client, isCurrentClient }: { client: ScopedOpencodeClient; isCurrentClient: (client: object) => boolean }) {
  const cache = useQueryClient();
  const identity = useQueryIdentity();
  const active = useQueryActivity();
  const key = useMemo(() => [...connectionQueryKey(identity, client.__opencode.contract), 'server', 'saved-permissions'], [identity, client]);
  const [query] = useQueries({ queries: [{ queryKey: key, enabled: false, subscribed: active, staleTime: 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => listSavedPermissionRules(withReadSignal(client, signal)) }].filter(() => active) });
  const refreshSavedPermissions = useCallback(async () => {
    if (active && isCurrentClient(client)) await cache.fetchQuery({ queryKey: key, staleTime: 0, queryFn: ({ signal }: { signal: AbortSignal }) => listSavedPermissionRules(withReadSignal(client, signal)) }).then(() => undefined);
  }, [active, cache, client, isCurrentClient, key]);
  const removeSavedPermission = useCallback(async (id: string) => {
    if (!isCurrentClient(client)) throw new Error('Connect this server before changing its permissions.');
    await cache.cancelQueries({ queryKey: key });
    await removeSavedPermissionRule(client, id);
    if (isCurrentClient(client)) { await cache.invalidateQueries({ queryKey: key, refetchType: 'none' }); await refreshSavedPermissions(); }
  }, [cache, client, isCurrentClient, key, refreshSavedPermissions]);
  return { savedPermissions: query?.data ?? EMPTY, refreshSavedPermissions, removeSavedPermission };
}
