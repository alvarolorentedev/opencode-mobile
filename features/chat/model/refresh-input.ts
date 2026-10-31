import type { Dispatch, SetStateAction } from 'react';

import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import type { SessionMessageRecord } from '@/shared/presentation/format';

import type { FileDiff, Todo } from '@/shared/protocol/opencode/types';

import type { DiffScope } from '@/shared/contracts/domain';
export type ChatRefreshInput = {

  client: ScopedOpencodeClient;

  isCurrentClient: (candidate: object) => boolean;

  setIsRefreshingDiffs: Dispatch<SetStateAction<boolean>>;

  setDiffsBySession: Dispatch<SetStateAction<Record<string, FileDiff[]>>>;

  setVcsDiffsByScope: Dispatch<SetStateAction<Record<'uncommitted' | 'branch', FileDiff[]>>>;

  setTodosBySession: Dispatch<SetStateAction<Record<string, Todo[]>>>;

  setDiffScopeBySession: Dispatch<SetStateAction<Record<string, DiffScope>>>;

  setSelectedDiffMessageBySession: Dispatch<SetStateAction<Record<string, string | undefined>>>;

  selectedDiffMessageBySessionRef: { current: Record<string, string | undefined> };

  diffScopeBySessionRef: { current: Record<string, DiffScope> };

  currentSessionIdRef: { current: string | undefined };

  messagesBySessionRef: { current: Record<string, SessionMessageRecord[]> };
};
