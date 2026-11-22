import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useCallback, useMemo } from 'react';
import { hashKey, useQuery } from '@tanstack/react-query';

import { useAppCore, useAppStore, useProjectScope, useWorkspaceDomainValue } from '@/runtime/core';
import { mcpOptions } from '@/shared/server-data/diagnostics';
import type { SessionLibraryContextValue } from './model/types';
import { projectSessionsOptions } from './services/queries';
import { usePermissionRulesState } from './state/use-permission-rules-state';
import { useSessionCatalog } from './state/use-session-catalog';

export function useCurrentSession() {
  const value = useWorkspaceDomainValue((values) => values.currentSessionValue, 'useCurrentSession');
  const { identity, client, scopeKey } = useProjectScope();
  const currentSessionId = useAppStore((state) => state.selection[scopeKey]?.currentSessionId);
  const { data: sessions } = useQuery(projectSessionsOptions(identity, client));
  const activeSession = currentSessionId ? sessions?.find(({ id }) => id === currentSessionId) : undefined;
  const { openSession: openDeepLinkSession } = useAppCore().commands.connection;
  return useMemo(() => ({ ...value, currentSessionId, activeSession, openDeepLinkSession }),
    [activeSession, currentSessionId, openDeepLinkSession, value]);
}

export function useSessionLibrary(): SessionLibraryContextValue {
  const { identity, client, directory, scopeKey, revision } = useProjectScope();
  const { connectionId, connectionScope } = identity;
  const { session, connection: { openSessionInProject: openInProject } } = useAppCore().commands;
  const { sessions, sessionStatuses } = useSessionCatalog(identity, client);
  const target = useMemo(() => ({ connectionId, projectPath: directory }), [connectionId, directory]);
  const { forkSession } = useMemo(() => session.creation(target, scopeKey, revision), [revision, scopeKey, session, target]);
  const { revertSession, unrevertSession } = useMemo(() => session.editing(target, scopeKey, revision), [revision, scopeKey, session, target]);
  const openSessionInProject = useCallback((projectPath: string, sessionId: string, targetConnectionScope = connectionScope) =>
    openInProject(projectPath, sessionId, targetConnectionScope), [connectionScope, openInProject]);
  return useMemo(() => ({ sessions, sessionStatuses, forkSession, revertSession, unrevertSession, openSessionInProject }),
    [sessions, sessionStatuses, forkSession, revertSession, unrevertSession, openSessionInProject]);
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
