import { useCallback } from 'react';

import { findProfileByConnectionScope, getProfilePassword, loadConnectionProfiles } from '@/lib/connection-profiles';
import { buildClient } from '@/lib/opencode/client';
import type { SessionDeepLinkTarget } from '@/providers/opencode-provider-types';
import { isAvailableProjectDirectory } from '@/providers/services/session-service';
import type { ConnectionActionsInput } from '@/providers/opencode-provider-action-inputs';
import type { useConnectionConnectActions } from '@/providers/use-connection-connect-actions';

type ConnectionLinkActionsInput = ConnectionActionsInput
  & Pick<ReturnType<typeof useConnectionConnectActions>, 'connect' | 'switchConnection'>;

export function useConnectionLinkActions({
  connect,
  switchConnection,
  selectProject,
  activeProjectPathRef,
  connectionRef,
  connectionScopeRef,
  currentSessionIdRef,
  deepLinkOperationRef,
  ensureActiveSessionRef,
  pendingDeepLinkTargetRef,
  projectPathsByConnectionRef,
  serverGenerationRef,
  serverProjectsRef,
  settingsRef,
  serverContractRef,
}: ConnectionLinkActionsInput) {
  const waitForConnectionScope = useCallback(async (scope: string, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (connectionScopeRef.current !== scope && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return connectionScopeRef.current === scope;
  }, [connectionScopeRef]);

  const switchToScope = useCallback(async (scope: string) => {
    if (scope === connectionScopeRef.current) return;
    const profile = findProfileByConnectionScope(await loadConnectionProfiles(), scope);
    if (!profile) throw new Error('The saved connection for this session no longer exists.');
    const password = await getProfilePassword(profile.id);
    await switchConnection({ serverUrl: profile.serverUrl, username: profile.username, password, connect: profile.connect }, profile.modelPreferences);
    if (!await waitForConnectionScope(scope)) throw new Error('Could not switch to the connection that owns this session.');
  }, [connectionScopeRef, switchConnection, waitForConnectionScope]);

  const openDeepLinkSession = useCallback(
    async (target: SessionDeepLinkTarget, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> => {
      const sessionId = target.sessionId.trim();
      const projectPath = target.projectPath?.trim();
      const operation = {};
      deepLinkOperationRef.current = operation;
      let operationServerGeneration: number | undefined;
      const ownsOperation = () => deepLinkOperationRef.current === operation &&
        (operationServerGeneration === undefined || operationServerGeneration === serverGenerationRef.current);
      const cancelOperation = () => {
        if (deepLinkOperationRef.current === operation) {
          pendingDeepLinkTargetRef.current = undefined;
          deepLinkOperationRef.current = undefined;
        }
      };
      const finish = (result: { ok: boolean; error?: string }) => {
        signal?.removeEventListener('abort', cancelOperation);
        if (deepLinkOperationRef.current === operation) {
          pendingDeepLinkTargetRef.current = undefined;
          deepLinkOperationRef.current = undefined;
        }
        return result;
      };
      signal?.addEventListener('abort', cancelOperation, { once: true });
      if (signal?.aborted) {
        cancelOperation();
        return finish({ ok: false, error: 'This session link was cancelled.' });
      }
      const connectionStatus = () => connectionRef.current.status;
      if (!sessionId) {
        return finish({ ok: false, error: 'This session link is missing a session ID.' });
      }

      if (target.connectionScope) {
        try {
          await switchToScope(target.connectionScope);
        } catch (error) {
          return finish({ ok: false, error: error instanceof Error ? error.message : 'Could not open the connection for this session.' });
        }
        if (!ownsOperation()) return finish({ ok: false, error: 'This session link was superseded.' });
      }

      if (connectionStatus() !== 'connected') {
        if (connectionStatus() !== 'connecting') {
          await connect();
        }
        const connectDeadline = Date.now() + 20000;
        while (connectionStatus() === 'connecting' && Date.now() < connectDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (!ownsOperation()) {
          return finish({ ok: false, error: 'This session link was superseded.' });
        }
        if (connectionStatus() !== 'connected') {
          return finish({ ok: false, error: connectionRef.current.message || 'Could not connect to the server.' });
        }
      }

      operationServerGeneration = serverGenerationRef.current;
      const targetProjectPath = projectPath || activeProjectPathRef.current;
      if (!targetProjectPath) {
        return finish({ ok: false, error: 'This session link does not name a project, and no project is open.' });
      }
      if (projectPath && projectPath !== activeProjectPathRef.current) {
        const opened = projectPathsByConnectionRef.current[connectionScopeRef.current] ?? [];
        const known = serverProjectsRef.current.some((project) => project.worktree === projectPath)
          || opened.includes(projectPath);
        if (!known) {
          // project.list() reports one canonical path per repository, while the
          // same project can have sibling checkouts and worktrees. Resolve the
          // directory instead of rejecting a path the server can serve.
          const targetClient = buildClient({ ...settingsRef.current, directory: projectPath }, serverContractRef.current);
          const available = await isAvailableProjectDirectory(targetClient, serverProjectsRef.current);
          if (!ownsOperation()) {
            return finish({ ok: false, error: 'This session link was superseded.' });
          }
          if (!available) {
            return finish({ ok: false, error: `Project ${projectPath} is not available from the configured server.` });
          }
        }
      }

      pendingDeepLinkTargetRef.current = { sessionId, projectPath: targetProjectPath };
      if (targetProjectPath !== activeProjectPathRef.current) {
        selectProject(targetProjectPath);
      }

      const deadline = Date.now() + 30000;
      while (ownsOperation() && activeProjectPathRef.current !== targetProjectPath && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!ownsOperation()) {
        return finish({ ok: false, error: 'This session link was superseded.' });
      }
      if (activeProjectPathRef.current !== targetProjectPath) {
        return finish({ ok: false, error: `Could not open the ${targetProjectPath} project.` });
      }

      let openedSessionId: string | undefined;
      try {
        for (let attempt = 0; attempt < 2 && openedSessionId !== sessionId; attempt += 1) {
          openedSessionId = await ensureActiveSessionRef.current();
          if (!ownsOperation()) {
            return finish({ ok: false, error: 'This session link was superseded.' });
          }
          if (openedSessionId !== sessionId) await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (error) {
        return finish({
          ok: false,
          error: error instanceof Error ? error.message : 'Could not open this session link.',
        });
      }

      while (ownsOperation() && openedSessionId === sessionId && currentSessionIdRef.current !== sessionId && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!ownsOperation()) {
        return finish({ ok: false, error: 'This session link was superseded.' });
      }
      if (currentSessionIdRef.current === sessionId) {
        return finish({ ok: true });
      }

      return finish({ ok: false, error: `Session ${sessionId} was not found in the ${targetProjectPath} project.` });
    },
    [activeProjectPathRef, connect, connectionRef, connectionScopeRef, currentSessionIdRef, deepLinkOperationRef, ensureActiveSessionRef, pendingDeepLinkTargetRef, projectPathsByConnectionRef, selectProject, serverContractRef, serverGenerationRef, serverProjectsRef, settingsRef, switchToScope],
  );

  const openSessionInProject = useCallback(async (projectPath: string, sessionId: string, targetConnectionScope?: string) => {
    if (targetConnectionScope && targetConnectionScope !== connectionScopeRef.current) {
      await switchToScope(targetConnectionScope);
    }

    const result = await openDeepLinkSession({ sessionId, projectPath });
    if (!result.ok) {
      throw new Error(result.error || 'Could not open the session.');
    }
  }, [connectionScopeRef, openDeepLinkSession, switchToScope]);

  return { openDeepLinkSession, openSessionInProject };
}
