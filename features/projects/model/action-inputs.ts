import type { Dispatch, SetStateAction } from 'react';

import type { OpencodeConnectionSettings, PendingPermissionRequest, PendingQuestionRequest, ScopedOpencodeClient, ServerContract } from '@/shared/protocol/opencode/client';

import type { SessionMessageRecord } from '@/shared/presentation/format';

import type { FileDiff, Session, SessionStatus, Todo } from '@/shared/protocol/opencode/types';

import type { SessionRefreshOptions } from '@/shared/protocol/opencode/event-dispatch';

import type { DiffScope, ProjectPathsByConnection, TranscriptRefreshMode } from '@/shared/contracts/domain';

export type ProjectActionsInput = {
  fileClipboard?: import('@/features/projects/state/use-file-clipboard').FileClipboard;
  connectionId: string;
  connected: boolean;
  refreshServerFeatures: () => Promise<void>;
  client: ScopedOpencodeClient;
  catalogClient: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  isCurrentCatalogClient: (candidate: object) => boolean;
  activeProjectPath?: string;
  setActiveProjectPath: Dispatch<SetStateAction<string | undefined>>;
  activeProjectPathRef: { current: string | undefined };
  clearProjectState: () => void;
  projectPathsByConnectionRef: { current: ProjectPathsByConnection };
  setProjectPathsByConnection: Dispatch<SetStateAction<ProjectPathsByConnection>>;
  connectionScope: string;
  connectionScopeRef: { current: string };
  isHydrated: boolean;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  sessionsRef: { current: Session[] };
  setSessionStatuses: Dispatch<SetStateAction<Record<string, SessionStatus>>>;
  locallyCreatedSessionsRef: { current: Map<string, number> };
  setIsRefreshingDiffs: Dispatch<SetStateAction<boolean>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setVcsDiffsByScope: Dispatch<SetStateAction<Record<'uncommitted' | 'branch', FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PendingPermissionRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, PendingQuestionRequest[]>>>;
  suppressedPendingRequestIdsRef?: { current: Set<string> };
  setDiffScopeBySession: Dispatch<SetStateAction<Record<string, DiffScope>>>;
  setSelectedDiffMessageBySession: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  selectedDiffMessageBySessionRef: { current: Record<string, string | undefined> };
  diffScopeBySessionRef: { current: Record<string, DiffScope> };
  currentSessionIdRef: { current: string | undefined };
  messagesBySessionRef: { current: Record<string, SessionMessageRecord[]> };
  projectFileRequestRef: { current: number };
  scopeGenerationRef: { current: number };
  sessionRefreshTimeoutsRef: { current: Record<string, ReturnType<typeof setTimeout>> };
  sessionRefreshOptionsRef: { current: Record<string, SessionRefreshOptions> };
  serverContract: ServerContract;
  settingsRef: { current: OpencodeConnectionSettings };
  refreshMessages: (sessionId: string, silent?: boolean, options?: { mode?: TranscriptRefreshMode }) => Promise<SessionMessageRecord[]>;
};

// Each extracted action hook declares only the slice it consumes. The aggregate
// inputs above are the composition contracts used by the provider wiring; these
// aliases keep sub-hooks from silently depending on unrelated setters and refs.
export type ProjectCatalogInput = Pick<ProjectActionsInput,
  'connected' | 'client' | 'catalogClient' | 'isCurrentClient' | 'isCurrentCatalogClient' | 'activeProjectPath' |
  'setActiveProjectPath' | 'activeProjectPathRef' | 'clearProjectState' | 'projectPathsByConnectionRef' |
  'setProjectPathsByConnection' |
  'connectionScope' | 'connectionScopeRef' | 'isHydrated' | 'setSessions' |
  'setSessionStatuses' | 'scopeGenerationRef' | 'serverContract' | 'settingsRef'>;

export type ProjectFileInput = Pick<ProjectActionsInput,
  'fileClipboard' | 'connectionId' | 'connected' | 'client' | 'isCurrentClient' | 'activeProjectPath' |
  'projectFileRequestRef' | 'currentSessionIdRef' |
  'diffScopeBySessionRef' | 'settingsRef' | 'refreshServerFeatures'> & {
  refreshVcsDiff: (scope: 'uncommitted' | 'branch', silent?: boolean) => Promise<unknown>;
};
