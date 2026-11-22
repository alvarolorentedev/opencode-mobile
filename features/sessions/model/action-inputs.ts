import type { Dispatch, SetStateAction } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import type { SessionMessageRecord } from '@/shared/presentation/format';

import type { Command, Config, FileDiff, Session, SessionStatus, Todo } from '@/shared/protocol/opencode/types';

import type { AgentOption, ModelOption } from '@/shared/contracts/model-options';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import type { ConnectionState, DiffScope, FavoriteSession, SessionDeepLinkTarget, TranscriptReadOptions } from '@/shared/contracts/domain';

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
  readDiffScope: (sessionId: string) => DiffScope | undefined;
  sessions: Session[];
  sessionsRef: { current: Session[] };
  sessionStatuses: Record<string, SessionStatus>;
  commands: Command[];
  availableAgents: AgentOption[];
  availableModels: ModelOption[];
  currentConfig?: Config;
  messagesBySession: Record<string, SessionMessageRecord[]>;
  favoriteSessions: FavoriteSession[];
  setCurrentSessionId: Dispatch<SetStateAction<string | undefined>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  locallyCreatedSessionsRef: { current: Map<string, number> };
  setMessagesBySession: Dispatch<SetStateAction<Record<string, SessionMessageRecord[]>>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>;
  setFavoriteSessions: Dispatch<SetStateAction<FavoriteSession[]>>;
  pendingDeepLinkTargetRef: { current: SessionDeepLinkTarget | undefined };
  openSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<Session[]>;
  refreshMessages: (sessionId: string, silent?: boolean, options?: TranscriptReadOptions) => Promise<SessionMessageRecord[]>;
  refreshSessionDiff: (sessionId: string, silent?: boolean, messageId?: string, records?: SessionMessageRecord[]) => Promise<FileDiff[]>;
  refreshSessionTodos: (sessionId: string) => Promise<Todo[]>;
  refreshVcsDiff: (scope: 'uncommitted' | 'branch', silent?: boolean) => Promise<FileDiff[]>;
  refreshPendingInteractions: () => Promise<unknown>;
  refreshChatCapabilities: () => Promise<unknown>;
  refreshServerFeatures: () => Promise<unknown>;
  refreshDiagnostics: () => Promise<unknown>;
  refreshActiveSessions: () => Promise<unknown>;
  chatPreferences: ChatPreferences;
};

export type SessionCrudInput = Pick<SessionActionsInput,
  'client' | 'isCurrentClient' | 'activeProjectPath' | 'connectionScopeRef' | 'currentSessionId' |
  'currentSessionIdRef' | 'explicitSessionSelectionRef' | 'locallyCreatedSessionsRef' | 'availableAgents' | 'availableModels' | 'currentConfig' |
  'sessions' | 'sessionStatuses' | 'commands' |
  'setCurrentSessionId' | 'openSession' |
  'setSessions' | 'setSessionStatuses' | 'setMessagesBySession' | 'setDiffsBySession' | 'setTodosBySession' |
  'setPendingPermissionsBySession' | 'setPendingQuestionsBySession' | 'setFavoriteSessions' | 'refreshSessions' |
  'refreshMessages' | 'refreshSessionDiff' | 'refreshActiveSessions' | 'chatPreferences'>;

export type SessionFavoriteInput = Pick<SessionActionsInput,
  'connectionScopeRef' | 'favoriteSessions' | 'setFavoriteSessions'>;
