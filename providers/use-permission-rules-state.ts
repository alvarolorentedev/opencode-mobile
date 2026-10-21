import { useCallback, type Dispatch, type SetStateAction } from 'react';

import {
  listSavedPermissionRules,
  removeSavedPermissionRule,
  type SavedPermissionRule,
  type ScopedOpencodeClient,
} from '@/lib/opencode/client';

// V2 `permission.saved` management. The list is server-derived and connection
// scoped; state lives in the provider so Settings never fetches directly.
export function usePermissionRulesState({
  client,
  isCurrentClient,
  setSavedPermissions,
}: {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  setSavedPermissions: Dispatch<SetStateAction<SavedPermissionRule[]>>;
}) {
  const refreshSavedPermissions = useCallback(async () => {
    if (!isCurrentClient(client)) return;
    try {
      const rules = await listSavedPermissionRules(client);
      if (!isCurrentClient(client)) {
        return;
      }
      setSavedPermissions(rules);
    } catch {
      // V2-only surface; a server without it keeps the current list.
    }
  }, [client, isCurrentClient, setSavedPermissions]);

  const removeSavedPermission = useCallback(
    async (id: string) => {
      if (!isCurrentClient(client)) throw new Error('Connect this server before changing its permissions.');
      await removeSavedPermissionRule(client, id);
      if (isCurrentClient(client)) {
        setSavedPermissions((current) => current.filter((rule) => rule.id !== id));
      }
    },
    [client, isCurrentClient, setSavedPermissions],
  );

  const resetPermissionRules = useCallback(() => {
    setSavedPermissions([]);
  }, [setSavedPermissions]);

  return { refreshSavedPermissions, removeSavedPermission, resetPermissionRules };
}
