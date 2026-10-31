import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getConnectionScope } from '@/lib/connection-scope';
import {
  type PendingPermissionRequest,
  type PendingQuestionRequest,
  type ServerContract
} from '@/lib/opencode/client';
import type { SessionMessageRecord } from '@/lib/opencode/format';
import type {
  FileDiff,
  Session,
  SessionStatus,
  Todo
} from '@/lib/opencode/types';
import type { SessionRefreshOptions } from '@/providers/opencode-provider-events';
import type {
  ConnectionState,
  DiffScope
} from '@/providers/opencode-provider-types';

import type { WorkspaceRuntimeInput } from './workspace-types';
export function useSessionRuntimeState(input: WorkspaceRuntimeInput, connection: ConnectionState, serverContract: ServerContract) {
  const settings = input.connection.settings;
  const setSettings = input.setSettings;
  const chatPreferences = input.preferences;
  const [activeProjectPath, setActiveProjectPath] = useState<string | undefined>(input.projectPath);
  const [sessions, setSessions] = useState<Session[]>([]);
  const sessionsRef = useRef<Session[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string>();
  const [messagesBySession, setMessagesBySession] = useState<Record<string, SessionMessageRecord[]>>({});
  const [diffsBySession, setDiffsBySession] = useState<Record<string, FileDiff[]>>({});
  const [vcsDiffsByScope, setVcsDiffsByScope] = useState<Record<'uncommitted' | 'branch', FileDiff[]>>({ uncommitted: [], branch: [] });
  const [diffScopeBySession, setDiffScopeBySession] = useState<Record<string, DiffScope>>({});
  const [selectedDiffMessageBySession, setSelectedDiffMessageBySession] = useState<Record<string, string | undefined>>({});
  const [todosBySession, setTodosBySession] = useState<Record<string, Todo[]>>({});
  const [pendingPermissionsBySession, setPendingPermissionsBySession] = useState<Record<string, PendingPermissionRequest[]>>({});
  const [pendingQuestionsBySession, setPendingQuestionsBySession] = useState<Record<string, PendingQuestionRequest[]>>({});
  const [mcpAuthPrompt, setMcpAuthPrompt] = useState<{ mcpName: string; url: string }>();
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [isRefreshingDiffs, setIsRefreshingDiffs] = useState(false);
  const [isBootstrappingChat, setIsBootstrappingChat] = useState(false);
  const [activeSessionsVisible, setActiveSessionsVisible] = useState(false);

  const connectionScope = useMemo(
    () => getConnectionScope({ serverUrl: settings.serverUrl, username: settings.username }),
    [settings.serverUrl, settings.username],
  );

  const settingsRef = useRef(settings);
  const chatPreferencesRef = useRef(chatPreferences);
  const connectionScopeRef = useRef(connectionScope);
  const activeProjectPathRef = useRef(activeProjectPath);
  const connectionRef = useRef(connection);
  const serverContractRef = useRef<ServerContract>('v2');
  const currentSessionIdRef = useRef<string | undefined>(undefined);
  const pendingDeepLinkTargetRef = useRef<import('@/providers/opencode-provider-types').SessionDeepLinkTarget | undefined>(undefined);
  const deepLinkOperationRef = useRef<object | undefined>(undefined);
  const scopeGenerationRef = useRef(0);
  const serverGenerationRef = useRef(0);
  const clientGenerationRef = useRef(new WeakMap<object, number>());
  const bootstrapPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const bootstrapTokenRef = useRef<object | undefined>(undefined);
  const sessionRefreshTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sessionRefreshOptionsRef = useRef<Record<string, SessionRefreshOptions>>({});
  const diffScopeBySessionRef = useRef<Record<string, DiffScope>>({});
  const selectedDiffMessageBySessionRef = useRef<Record<string, string | undefined>>({});
  const messagesBySessionRef = useRef(messagesBySession);
  const busyNotificationsRef = useRef<Set<string>>(new Set());
  const explicitSessionSelectionRef = useRef<string | undefined>(undefined);
  const locallyCreatedSessionsRef = useRef<Map<string, number>>(new Map());
  const suppressedPendingRequestIdsRef = useRef<Set<string>>(new Set());
  const promptSubmissionRef = useRef<{ active: boolean; sessionId?: string }>({ active: false });
  const projectFileRequestRef = useRef(0);

  // Latest-ref mirror. Updating refs in a layout effect (instead of during
  // render) is the React-sanctioned pattern: the mirrored values are only read
  // from callbacks, async work, and effects, all of which run after commit.
  useLayoutEffect(() => {
    serverContractRef.current = serverContract;
    settingsRef.current = settings;
    chatPreferencesRef.current = chatPreferences;
    connectionScopeRef.current = connectionScope;
    activeProjectPathRef.current = activeProjectPath;
    connectionRef.current = connection;
    currentSessionIdRef.current = currentSessionId;
    sessionsRef.current = sessions;
    diffScopeBySessionRef.current = diffScopeBySession;
    selectedDiffMessageBySessionRef.current = selectedDiffMessageBySession;
    messagesBySessionRef.current = messagesBySession;
  });

  return {
    settings, setSettings,
    connection,
    serverContract,
    activeProjectPath, setActiveProjectPath,
    sessions, setSessions, sessionsRef,
    sessionStatuses, setSessionStatuses,
    currentSessionId, setCurrentSessionId,
    messagesBySession, setMessagesBySession,
    diffsBySession, setDiffsBySession,
    vcsDiffsByScope, setVcsDiffsByScope,
    diffScopeBySession, setDiffScopeBySession,
    selectedDiffMessageBySession, setSelectedDiffMessageBySession,
    todosBySession, setTodosBySession,
    pendingPermissionsBySession, setPendingPermissionsBySession,
    pendingQuestionsBySession, setPendingQuestionsBySession,
    mcpAuthPrompt, setMcpAuthPrompt,
    isRefreshingMessages, setIsRefreshingMessages,
    isRefreshingDiffs, setIsRefreshingDiffs,
    isBootstrappingChat, setIsBootstrappingChat,
    activeSessionsVisible, setActiveSessionsVisible,
    connectionScope,
    settingsRef,
    chatPreferencesRef,
    connectionScopeRef,
    activeProjectPathRef,
    connectionRef,
    serverContractRef,
    currentSessionIdRef,
    pendingDeepLinkTargetRef,
    deepLinkOperationRef,
    scopeGenerationRef,
    serverGenerationRef,
    clientGenerationRef,
    bootstrapPromiseRef,
    bootstrapTokenRef,
    sessionRefreshTimeoutsRef,
    sessionRefreshOptionsRef,
    diffScopeBySessionRef,
    selectedDiffMessageBySessionRef,
    messagesBySessionRef,
    busyNotificationsRef,
    explicitSessionSelectionRef,
    locallyCreatedSessionsRef,
    suppressedPendingRequestIdsRef,
    promptSubmissionRef,
    projectFileRequestRef,
  };
}

export type SessionRuntimeState = ReturnType<typeof useSessionRuntimeState>;
