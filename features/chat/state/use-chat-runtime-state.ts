import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';
import type { ChatUiState } from '@/runtime/core';
import type { DiffScope } from '@/shared/contracts/domain';

const EMPTY: ChatUiState = {
  diffScopeBySession: {},
  selectedDiffMessageBySession: {},
  isRefreshingMessages: false,
  isRefreshingDiffs: false,
  readErrors: {},
};

function apply<T>(value: SetStateAction<T>, previous: T): T {
  return typeof value === 'function' ? (value as (current: T) => T)(previous) : value;
}

// Chat-only UI state is per workspace but not a server fact. The refs stay for
// async callbacks; the values live in the app store so a scope can be read
// without a context tree.
export function useChatRuntimeState(scopeKey: string) {
  const { store } = useAppCore();
  const chat = useAppStore((state) => state.chat[scopeKey] ?? EMPTY);
  const write = useCallback((patch: Partial<ChatUiState> | ((current: ChatUiState) => Partial<ChatUiState>)) => {
    store.getState().setChat(scopeKey, patch);
  }, [scopeKey, store]);

  const setDiffScopeBySession = useCallback<Dispatch<SetStateAction<Record<string, DiffScope>>>>((value) => {
    write((current) => ({ diffScopeBySession: apply(value, current.diffScopeBySession) }));
  }, [write]);
  const setSelectedDiffMessageBySession = useCallback<Dispatch<SetStateAction<Record<string, string | undefined>>>>((value) => {
    write((current) => ({ selectedDiffMessageBySession: apply(value, current.selectedDiffMessageBySession) }));
  }, [write]);
  const setIsRefreshingMessages = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    write((current) => ({ isRefreshingMessages: apply(value, current.isRefreshingMessages) }));
  }, [write]);
  const setIsRefreshingDiffs = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    write((current) => ({ isRefreshingDiffs: apply(value, current.isRefreshingDiffs) }));
  }, [write]);

  const diffScopeBySessionRef = useRef(chat.diffScopeBySession);
  const selectedDiffMessageBySessionRef = useRef(chat.selectedDiffMessageBySession);
  useLayoutEffect(() => {
    diffScopeBySessionRef.current = chat.diffScopeBySession;
    selectedDiffMessageBySessionRef.current = chat.selectedDiffMessageBySession;
  });

  const busyNotificationsRef = useRef<Set<string>>(new Set());
  const promptSubmissionRef = useRef<{ active: boolean; sessionId?: string }>({ active: false });
  return {
    diffScopeBySession: chat.diffScopeBySession,
    setDiffScopeBySession,
    selectedDiffMessageBySession: chat.selectedDiffMessageBySession,
    setSelectedDiffMessageBySession,
    isRefreshingMessages: chat.isRefreshingMessages,
    setIsRefreshingMessages,
    isRefreshingDiffs: chat.isRefreshingDiffs,
    setIsRefreshingDiffs,
    diffScopeBySessionRef,
    selectedDiffMessageBySessionRef,
    busyNotificationsRef,
    promptSubmissionRef,
  };
}
