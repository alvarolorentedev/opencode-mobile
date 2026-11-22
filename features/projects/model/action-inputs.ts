import type { Dispatch, SetStateAction } from 'react';
import type { QueryIdentity } from '@/shared/server-data/keys';

import type { OpencodeConnectionSettings, ScopedOpencodeClient, ServerContract } from '@/shared/protocol/opencode/client';

import type { SessionMessageRecord } from '@/shared/presentation/format';

import type { FileDiff, Todo } from '@/shared/protocol/opencode/types';

import type { DiffScope, TranscriptReadOptions } from '@/shared/contracts/domain';

export type ProjectActionsInput = {
  identity: QueryIdentity;
  queryActive: boolean;
  scopeKey: string;
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
  connectionScope: string;
  connectionScopeRef: { current: string };
  isHydrated: boolean;
  setIsRefreshingDiffs: Dispatch<SetStateAction<boolean>>;
  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;
  setVcsDiffsByScope: Dispatch<SetStateAction<Record<'uncommitted' | 'branch', FileDiff[]>>>;
  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;
  setDiffScopeBySession: Dispatch<SetStateAction<Record<string, DiffScope>>>;
  setSelectedDiffMessageBySession: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  readPinnedDiffMessage: (sessionId: string) => string | undefined;
  readDiffScope: (sessionId: string) => DiffScope | undefined;
  currentSessionIdRef: { current: string | undefined };
  readDisplayedSession: (sessionId: string) => SessionMessageRecord[];
  projectFileRequestRef: { current: number };
  scopeGenerationRef: { current: number };
  serverContract: ServerContract;
  settingsRef: { current: OpencodeConnectionSettings };
  refreshMessages: (sessionId: string, silent?: boolean, options?: TranscriptReadOptions) => Promise<SessionMessageRecord[]>;
};

// Each extracted action hook declares only the slice it consumes. The aggregate
// inputs above are the composition contracts used by the provider wiring; these
// aliases keep sub-hooks from silently depending on unrelated setters and refs.
export type ProjectCatalogInput = Pick<ProjectActionsInput,
  'identity' | 'queryActive' | 'connected' | 'client' | 'catalogClient' | 'isCurrentClient' | 'isCurrentCatalogClient' | 'activeProjectPath' |
  'setActiveProjectPath' | 'activeProjectPathRef' | 'clearProjectState' |
  'connectionScope' | 'connectionScopeRef' | 'isHydrated' | 'scopeGenerationRef' | 'serverContract' | 'settingsRef'>;

export type ProjectFileInput = Pick<ProjectActionsInput,
  'identity' | 'queryActive' | 'scopeKey' | 'fileClipboard' | 'connectionId' | 'connected' | 'client' | 'isCurrentClient' | 'activeProjectPath' |
  'projectFileRequestRef' | 'currentSessionIdRef' |
  'readDiffScope' | 'settingsRef' | 'refreshServerFeatures'> & {
  refreshVcsDiff: (scope: 'uncommitted' | 'branch', silent?: boolean) => Promise<unknown>;
};
