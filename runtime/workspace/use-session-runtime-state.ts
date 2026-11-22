import { useCallback, useMemo, useRef, type SetStateAction } from 'react';

import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { workspaceKey } from '@/shared/contracts/workspace';
import type { ServerContract } from '@/shared/protocol/opencode/client';

import type { SessionRefreshOptions } from '@/shared/protocol/opencode/event-dispatch';
import type { ConnectionState } from '@/shared/contracts/domain';

import type { WorkspaceRuntimeInput } from '@/runtime/workspace/workspace-types';

import { useProjectRuntimeState } from '@/features/projects/runtime';
import { useSessionState } from '@/features/sessions/runtime';
import { useExtensionPromptState } from '@/features/extensions/runtime';
import { useAppCore, useAppStore } from '@/runtime/core';
import { EMPTY_CHAT, type ChatUiState } from '@/runtime/core/store';

export function useSessionRuntimeState(input: WorkspaceRuntimeInput, connection: ConnectionState, serverContract: ServerContract) {
  const settings = input.connection.settings;
  const setSettings = input.setSettings;
  const connectionId = input.connection.id;
  const scopeKey = workspaceKey({ connectionId: input.connection.id, projectPath: input.projectPath ?? '' });
  const { activeProjectPath, setActiveProjectPath, activeProjectPathRef, projectFileRequestRef } = useProjectRuntimeState(scopeKey, input.projectPath);
  const { currentSessionId, setCurrentSessionId, isBootstrappingChat, activeSessionsVisible, setActiveSessionsVisible, currentSessionIdRef, pendingDeepLinkTargetRef, deepLinkOperationRef, explicitSessionSelectionRef } = useSessionState(scopeKey);
  const { store, commands } = useAppCore();
  const cancelBootstrap = useCallback(() => commands.session.cancelBootstrap(scopeKey), [commands, scopeKey]);
  const { diffScopeBySession, selectedDiffMessageBySession, isRefreshingMessages, isRefreshingDiffs } = useAppStore((state) => state.chat[scopeKey] ?? EMPTY_CHAT);
  const chatActions = useMemo(() => {
    const change = <K extends keyof ChatUiState>(key: K) => (value: SetStateAction<ChatUiState[K]>) => {
      store.getState().setChat(scopeKey, (current) => ({ [key]: typeof value === 'function' ? value(current[key]) : value }));
    };
    return {
      setDiffScopeBySession: change('diffScopeBySession'),
      setSelectedDiffMessageBySession: change('selectedDiffMessageBySession'),
      setIsRefreshingMessages: change('isRefreshingMessages'),
      setIsRefreshingDiffs: change('isRefreshingDiffs'),
      readDiffScope: (sessionId: string) => store.getState().chat[scopeKey]?.diffScopeBySession[sessionId],
      readPinnedDiffMessage: (sessionId: string) => store.getState().chat[scopeKey]?.selectedDiffMessageBySession[sessionId],
    };
  }, [scopeKey, store]);
  const { mcpAuthPrompt, setMcpAuthPrompt } = useExtensionPromptState();

  const connectionScope = useMemo(
    () => getConnectionScope({ serverUrl: settings.serverUrl, username: settings.username }),
    [settings.serverUrl, settings.username],
  );

  const settingsRef = useMemo(() => ({
    get current() { return store.getState().registry.connections.find((entry) => entry.id === connectionId)?.settings ?? settings; },
  }), [connectionId, settings, store]);
  const connectionScopeRef = useMemo(() => ({ get current() { return getConnectionScope(settingsRef.current); } }), [settingsRef]);
  const scopeGenerationRef = useRef(0);
  const serverGenerationRef = useRef(0);
  const clientGenerationRef = useRef(new WeakMap<object, number>());
  const sessionRefreshTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sessionRefreshOptionsRef = useRef<Record<string, SessionRefreshOptions>>({});

  return {
    scopeKey,
    settings, setSettings,
    connection,
    serverContract,
    activeProjectPath, setActiveProjectPath,
    currentSessionId, setCurrentSessionId,
    diffScopeBySession, selectedDiffMessageBySession, ...chatActions,
    mcpAuthPrompt, setMcpAuthPrompt,
    isRefreshingMessages, isRefreshingDiffs,
    isBootstrappingChat, cancelBootstrap,
    activeSessionsVisible, setActiveSessionsVisible,
    connectionScope,
    settingsRef,
    connectionScopeRef,
    activeProjectPathRef,
    currentSessionIdRef,
    pendingDeepLinkTargetRef,
    deepLinkOperationRef,
    scopeGenerationRef,
    serverGenerationRef,
    clientGenerationRef,
    sessionRefreshTimeoutsRef,
    sessionRefreshOptionsRef,
    explicitSessionSelectionRef,
    projectFileRequestRef,
  };
}

export type SessionRuntimeState = ReturnType<typeof useSessionRuntimeState>;
