import type { Dispatch, SetStateAction } from 'react';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import type { SessionMessageRecord } from '@/shared/presentation/format';

import type { FileDiff, Todo } from '@/shared/protocol/opencode/types';

import type { DiffScope } from '@/features/projects/index';
export type ChatRefreshInput = {

  client: ScopedOpencodeClient;

  isCurrentClient: (candidate: object) => boolean;

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
};
