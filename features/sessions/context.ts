import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import { useCallback, useMemo } from 'react';
import { hashKey, useQuery } from '@tanstack/react-query';

import { useActiveWorkspaceTarget, useAppCore, useAppStore, useProjectScope } from '@/runtime/core';
import { mcpOptions } from '@/shared/server-data/diagnostics';
import type { CurrentSessionContextValue, SessionLibraryContextValue } from './model/types';
import { projectSessionsOptions } from './services/queries';
import { usePermissionRulesState } from './state/use-permission-rules-state';
import { useSessionCatalog } from './state/use-session-catalog';

function useSessionScope() {
  const scope = useProjectScope();
  const { identity: { connectionId }, directory } = scope;
  const target = useMemo(() => ({ connectionId, projectPath: directory }), [connectionId, directory]);
  return { ...scope, target };
}

export function useCurrentSession(): CurrentSessionContextValue {
  const { identity, client, scopeKey, target, revision } = useSessionScope();
  const currentSessionId = useAppStore((state) => state.selection[scopeKey]?.currentSessionId);
  const { data: sessions } = useQuery(projectSessionsOptions(identity, client));
  const activeSession = currentSessionId ? sessions?.find(({ id }) => id === currentSessionId) : undefined;
  const { session, connection: { openSession: openDeepLinkSession } } = useAppCore().commands;
  const { ensureActiveSession, openSession } = useMemo(() => session.navigation(target, scopeKey, revision), [revision, scopeKey, session, target]);
  const { createSession } = useMemo(() => session.creation(target, scopeKey, revision), [revision, scopeKey, session, target]);
  return useMemo(() => ({ currentSessionId, activeSession, ensureActiveSession, openSession, openDeepLinkSession, createSession }),
    [activeSession, createSession, currentSessionId, ensureActiveSession, openDeepLinkSession, openSession]);
}

export function useSessionLibrary(): SessionLibraryContextValue {
  const { identity, client, target, scopeKey, revision } = useSessionScope();
  const { connectionScope } = identity;
  const { session, connection: { openSessionInProject: openInProject } } = useAppCore().commands;
  const { sessions, sessionStatuses } = useSessionCatalog(identity, client);
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

export function useAutoApprove(target?: WorkspaceTarget) {
  const connectionId = useActiveWorkspaceTarget(target)?.connectionId ?? '';
  const revision = useAppStore((state) => state.registry.connections.find(({ id }) => id === connectionId)?.revision);
  const { setAutoApprove } = useAppCore().commands.connection;
  return useCallback((enabled: boolean) => setAutoApprove(connectionId, revision, enabled), [connectionId, revision, setAutoApprove]);
}

export { useServerPendingInteractions } from './state/use-server-pending-interactions';
