import { useRef, useState } from 'react';

import type { DiffScope } from '@/shared/contracts/domain';

export function useChatRuntimeState() {

  const [diffScopeBySession, setDiffScopeBySession] = useState<Record<string, DiffScope>>({});

  const [selectedDiffMessageBySession, setSelectedDiffMessageBySession] = useState<Record<string, string | undefined>>({});

  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);

  const [isRefreshingDiffs, setIsRefreshingDiffs] = useState(false);

  const diffScopeBySessionRef = useRef<Record<string, DiffScope>>({});

  const selectedDiffMessageBySessionRef = useRef<Record<string, string | undefined>>({});

  const busyNotificationsRef = useRef<Set<string>>(new Set());

  const promptSubmissionRef = useRef<{ active: boolean; sessionId?: string }>({ active: false });
  return { diffScopeBySession, setDiffScopeBySession, selectedDiffMessageBySession, setSelectedDiffMessageBySession, isRefreshingMessages, setIsRefreshingMessages, isRefreshingDiffs, setIsRefreshingDiffs, diffScopeBySessionRef, selectedDiffMessageBySessionRef, busyNotificationsRef, promptSubmissionRef };
}
