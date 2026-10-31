import { useRef, useState } from 'react';

import type { SessionMessageRecord } from '@/shared/presentation/format';

import type { FileDiff, Todo } from '@/shared/protocol/opencode/types';

import type { DiffScope } from '@/shared/contracts/domain';

export function useChatRuntimeState() {

  const [messagesBySession, setMessagesBySession] = useState<Record<string, SessionMessageRecord[]>>({});

  const [diffsBySession, setDiffsBySession] = useState<Record<string, FileDiff[]>>({});

  const [vcsDiffsByScope, setVcsDiffsByScope] = useState<Record<'uncommitted' | 'branch', FileDiff[]>>({ uncommitted: [], branch: [] });

  const [diffScopeBySession, setDiffScopeBySession] = useState<Record<string, DiffScope>>({});

  const [selectedDiffMessageBySession, setSelectedDiffMessageBySession] = useState<Record<string, string | undefined>>({});

  const [todosBySession, setTodosBySession] = useState<Record<string, Todo[]>>({});

  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);

  const [isRefreshingDiffs, setIsRefreshingDiffs] = useState(false);

  const diffScopeBySessionRef = useRef<Record<string, DiffScope>>({});

  const selectedDiffMessageBySessionRef = useRef<Record<string, string | undefined>>({});

  const messagesBySessionRef = useRef(messagesBySession);

  const busyNotificationsRef = useRef<Set<string>>(new Set());

  const promptSubmissionRef = useRef<{ active: boolean; sessionId?: string }>({ active: false });
  return { messagesBySession, setMessagesBySession, diffsBySession, setDiffsBySession, vcsDiffsByScope, setVcsDiffsByScope, diffScopeBySession, setDiffScopeBySession, selectedDiffMessageBySession, setSelectedDiffMessageBySession, todosBySession, setTodosBySession, isRefreshingMessages, setIsRefreshingMessages, isRefreshingDiffs, setIsRefreshingDiffs, diffScopeBySessionRef, selectedDiffMessageBySessionRef, messagesBySessionRef, busyNotificationsRef, promptSubmissionRef };
}
