import { useCallback, type SetStateAction } from 'react';

import { useCapabilitiesActions } from '@/features/ai/runtime';
import { useAppCore, useProjectScope } from '@/runtime/core';
import { workspaceChatPreferences } from '@/runtime/core/commands/connection';
import { useWorkspacePreferences } from '@/runtime/workspace/workspace-context';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import { useWorkspaceServerData } from '@/runtime/workspace/use-workspace-server-data';

export function WorkspaceCatalogReads({ target, hydrated }: { target?: WorkspaceTarget; hydrated: boolean }) {
  const scope = useProjectScope(target);
  const { client, connected, identity, isCurrentClient } = scope;
  const { store, commands: { connection } } = useAppCore();
  const { chatPreferences } = useWorkspacePreferences(target);
  const setChatPreferences = useCallback((update: SetStateAction<ChatPreferences>) => {
    if (!isCurrentClient(client)) return;
    const state = store.getState();
    const current = state.registry.connections.find((item) => item.id === identity.connectionId);
    if (!current?.enabled) return;
    connection.updatePreferences(current.id, typeof update === 'function'
      ? update(workspaceChatPreferences(state.shell.chatPreferences, current.preferences)) : update);
  }, [client, connection, identity.connectionId, isCurrentClient, store]);
  const data = useWorkspaceServerData(identity, client, connected, isCurrentClient, Boolean(target && scope.queryActive));
  useCapabilitiesActions({ ...scope, ...data, isHydrated: hydrated, activeProjectPath: scope.directory, chatPreferences, setChatPreferences });
  return null;
}
