import type { QueryIdentity } from '@/shared/server-data/keys';
import { removeSavedPermissionRule, type ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { savedPermissionOptions } from '../services/queries';
const EMPTY: never[] = [];
export function usePermissionRulesState({ client, identity, isCurrentClient, queryActive: active }: { client: ScopedOpencodeClient; identity: QueryIdentity; isCurrentClient: (client: object) => boolean; queryActive: boolean }) {
  const cache = useQueryClient();
  const options = useMemo(() => savedPermissionOptions(identity, client), [identity, client]);
  const { queryKey } = options;
  const [query] = useQueries({ queries: [{ ...options, enabled: false, subscribed: active }].filter(() => active) });
  const refreshSavedPermissions = useCallback(async () => {
    if (active && isCurrentClient(client)) await cache.fetchQuery(options).then(() => undefined);
  }, [active, cache, client, isCurrentClient, options]);
  const removeSavedPermission = useCallback(async (id: string) => {
    if (!isCurrentClient(client)) throw new Error('Connect this server before changing its permissions.');
    await cache.cancelQueries({ queryKey });
    await removeSavedPermissionRule(client, id);
    if (isCurrentClient(client)) { await cache.invalidateQueries({ queryKey, refetchType: 'none' }); await refreshSavedPermissions(); }
  }, [cache, client, isCurrentClient, queryKey, refreshSavedPermissions]);
  return { savedPermissions: query?.data ?? EMPTY, refreshSavedPermissions, removeSavedPermission };
}
