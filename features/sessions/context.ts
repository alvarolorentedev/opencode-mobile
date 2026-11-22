import { useCallback, useMemo } from 'react';

import { useAppCore, useWorkspaceDomainValue } from '@/runtime/core';
import { getConnectionScope } from '@/shared/contracts/connection-scope';

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

export const useApprovals = () => useWorkspaceDomainValue((values) => values.approvalsValue, 'useApprovals');
