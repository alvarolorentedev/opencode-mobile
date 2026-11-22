import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useCallback, useMemo } from 'react';
import { hashKey } from '@tanstack/react-query';

import { useAppCore, useAppStore, useProjectScope, useWorkspaceDomainValue } from '@/runtime/core';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { mcpOptions } from '@/shared/server-data/diagnostics';
import { usePermissionRulesState } from './state/use-permission-rules-state';

export function useCurrentSession() {
  const value = useWorkspaceDomainValue((values) => values.currentSessionValue, 'useCurrentSession');
  const { openSession: openDeepLinkSession } = useAppCore().commands.connection;
  return useMemo(() => ({ ...value, openDeepLinkSession }), [openDeepLinkSession, value]);
}

export function useSessionLibrary() {
  const value = useWorkspaceDomainValue((values) => values.sessionLibraryValue, 'useSessionLibrary');
  const settings = useWorkspaceDomainValue((values) => values.connectionValue.settings, 'useSessionLibrary');
  const { openSessionInProject: openInProject } = useAppCore().commands.connection;
  const scope = getConnectionScope(settings);
  const openSessionInProject = useCallback((projectPath: string, sessionId: string, targetConnectionScope = scope) =>
    openInProject(projectPath, sessionId, targetConnectionScope), [openInProject, scope]);
  return useMemo(() => ({ ...value, openSessionInProject }), [openSessionInProject, value]);
}

export function useApprovals(target?: WorkspaceTarget) {
  const scope = useProjectScope(target);
  const { store } = useAppCore();
  const { savedPermissions, refreshSavedPermissions, removeSavedPermission } = usePermissionRulesState(scope);
  const key = hashKey(mcpOptions(scope.identity, scope.client).queryKey);
  const mcpAuth = useAppStore((state) => state.mcpAuthPrompt && hashKey(state.mcpAuthPrompt.queryKey) === key ? state.mcpAuthPrompt : undefined);
  const dismissMcpAuth = useCallback(() => {
    store.getState().setMcpAuthPrompt((current) => current === mcpAuth ? undefined : current);
  }, [mcpAuth, store]);
  return useMemo(() => ({ approvals: { mcpAuth, dismissMcpAuth, savedPermissions, refreshSavedPermissions, removeSavedPermission } }),
    [dismissMcpAuth, mcpAuth, refreshSavedPermissions, removeSavedPermission, savedPermissions]);
}

export { useServerPendingInteractions } from './state/use-server-pending-interactions';
