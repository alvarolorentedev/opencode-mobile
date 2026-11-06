import type { Dispatch, SetStateAction } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import type { SessionMessageRecord } from '@/shared/presentation/format';

import type { Command, Config, FileDiff, Session, SessionStatus, Todo } from '@/shared/protocol/opencode/types';

import type { AgentOption, ModelOption } from '@/shared/contracts/model-options';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import type { ConnectionState, DiffScope, FavoriteSession, SessionDeepLinkTarget, TranscriptRefreshMode } from '@/shared/contracts/domain';

export type SessionActionsInput = {
  client: ScopedOpencodeClient;
  catalogClient: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  isCurrentCatalogClient: (candidate: object) => boolean;
  activeProjectPath?: string;
  connection: ConnectionState;
  connectionScope: string;
  connectionScopeRef: { current: string };
  currentSessionId?: string;
  currentSessionIdRef: { current: string | undefined };
  explicitSessionSelectionRef: { current: string | undefined };
  diffScopeBySessionRef: { current: Record<string, DiffScope> };
  sessions: Session[];
  sessionsRef: { current: Session[] };
  sessionStatuses: Record<string, SessionStatus>;
  commands: Command[];
  availableAgents: AgentOption[];
  currentConfig?: Config;
  availableModels: ModelOption[];
  messagesBySession: Record<string, SessionMessageRecord[]>;
  favoriteSessions: FavoriteSession[];
  pendingPermissionsBySession: Record<string, PendingPermissionRequest[]>;
  pendingQuestionsBySession: Record<string, PendingQuestionRequest[]>;
  setCurrentSessionId: Dispatch<SetStateAction<string | undefined>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  locallyCreatedSessionsRef: { current: Map<string, number> };
  setMessagesBySession: Dispatch<SetStateAction<Record<string, SessionMessageRecord[]>>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>;
  suppressedPendingRequestIdsRef: { current: Set<string> };
  setFavoriteSessions: Dispatch<SetStateAction<FavoriteSession[]>>;
  setIsBootstrappingChat: Dispatch<SetStateAction<boolean>>;
  pendingDeepLinkTargetRef: { current: SessionDeepLinkTarget | undefined };
  bootstrapPromiseRef: { current: Promise<string | undefined> | null };
  bootstrapTokenRef: { current: object | undefined };
  refreshSessions: () => Promise<Session[]>;
  refreshMessages: (sessionId: string, silent?: boolean, options?: { mode?: TranscriptRefreshMode }) => Promise<SessionMessageRecord[]>;
  beginHydration: (sessionId: string) => () => void;
  refreshSessionDiff: (sessionId: string, silent?: boolean, messageId?: string) => Promise<FileDiff[]>;
  refreshSessionTodos: (sessionId: string) => Promise<Todo[]>;
  refreshVcsDiff: (scope: 'uncommitted' | 'branch', silent?: boolean) => Promise<FileDiff[]>;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshChatCapabilities: () => Promise<unknown>;
  refreshServerFeatures: () => Promise<unknown>;
  refreshDiagnostics: () => Promise<unknown>;
  refreshActiveSessions: () => Promise<unknown>;
  refreshSavedPermissions?: () => Promise<void>;
  chatPreferences: ChatPreferences;
};

export type SessionCrudInput = Pick<SessionActionsInput,
  'client' | 'isCurrentClient' | 'activeProjectPath' | 'connectionScopeRef' | 'currentSessionId' |
  'currentSessionIdRef' | 'explicitSessionSelectionRef' | 'locallyCreatedSessionsRef' | 'availableModels' | 'availableAgents' | 'currentConfig' |
  'diffScopeBySessionRef' | 'sessions' | 'sessionStatuses' | 'commands' | 'bootstrapPromiseRef' | 'bootstrapTokenRef' |
  'setCurrentSessionId' | 'setIsBootstrappingChat' | 'beginHydration' |
  'setSessions' | 'setSessionStatuses' | 'setMessagesBySession' | 'setDiffsBySession' | 'setTodosBySession' |
  'setPendingPermissionsBySession' | 'setPendingQuestionsBySession' | 'setFavoriteSessions' | 'refreshSessions' |
  'refreshMessages' | 'refreshSessionDiff' | 'refreshSessionTodos' | 'refreshVcsDiff' |
  'refreshPendingInteractions' | 'refreshActiveSessions' | 'chatPreferences'>;

export type SessionFavoriteInput = Pick<SessionActionsInput,
  'connectionScopeRef' | 'favoriteSessions' | 'setFavoriteSessions'>;

export type SessionInteractionInput = Pick<SessionActionsInput,
  'client' | 'pendingPermissionsBySession' | 'pendingQuestionsBySession' | 'setPendingPermissionsBySession' |
  'setPendingQuestionsBySession' | 'suppressedPendingRequestIdsRef' | 'refreshMessages' | 'refreshSavedPermissions'>;

export type SessionBootstrapInput = Pick<SessionActionsInput,
  'activeProjectPath' | 'connection' | 'client' | 'currentSessionId' | 'currentSessionIdRef' |
  'explicitSessionSelectionRef' | 'sessionsRef' | 'messagesBySession' |
  'pendingDeepLinkTargetRef' | 'bootstrapPromiseRef' | 'bootstrapTokenRef' | 'isCurrentClient' | 'refreshSessions' |
  'refreshMessages' | 'refreshSessionDiff' | 'refreshSessionTodos' | 'refreshPendingInteractions' |
  'refreshChatCapabilities' | 'refreshServerFeatures' | 'setCurrentSessionId' |
  'setIsBootstrappingChat'> & {
  createSession: (title?: string) => Promise<Session>;
};
