import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { PendingPermissionRequest, PendingQuestionRequest } from '@/shared/protocol/opencode/client';
import { useAppCore, useAppStore } from '@/runtime/core';
import type { SelectionState } from '@/runtime/core';

const EMPTY_SELECTION: SelectionState = {
  currentSessionId: undefined,
  isBootstrappingChat: false,
  activeSessionsVisible: false,
};

export function useSessionState(scopeKey: string) {
  const { store } = useAppCore();
  const selection = useAppStore((state) => state.selection[scopeKey]) ?? EMPTY_SELECTION;
  const write = useCallback((patch: Partial<SelectionState> | ((current: SelectionState) => Partial<SelectionState>)) => {
    store.getState().setSelection(scopeKey, patch);
  }, [scopeKey, store]);

  const currentSessionId = selection.currentSessionId;
  const setCurrentSessionId = useCallback<Dispatch<SetStateAction<string | undefined>>>((value) => {
    write((current) => ({ currentSessionId: typeof value === 'function' ? value(current.currentSessionId) : value }));
  }, [write]);
  const isBootstrappingChat = selection.isBootstrappingChat;
  const setIsBootstrappingChat = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    write((current) => ({ isBootstrappingChat: typeof value === 'function' ? value(current.isBootstrappingChat) : value }));
  }, [write]);
  const activeSessionsVisible = selection.activeSessionsVisible;
  const setActiveSessionsVisible = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    write((current) => ({ activeSessionsVisible: typeof value === 'function' ? value(current.activeSessionsVisible) : value }));
  }, [write]);

  const [pendingPermissionsBySession, setPendingPermissionsBySession] = useState<Record<string, PendingPermissionRequest[]>>({});

  const [pendingQuestionsBySession, setPendingQuestionsBySession] = useState<Record<string, PendingQuestionRequest[]>>({});

  const currentSessionIdRef = useRef<string | undefined>(currentSessionId);

  const pendingDeepLinkTargetRef = useRef<import('@/shared/contracts/domain').SessionDeepLinkTarget | undefined>(undefined);

  const deepLinkOperationRef = useRef<object | undefined>(undefined);

  const bootstrapPromiseRef = useRef<Promise<string | undefined> | null>(null);

  const bootstrapTokenRef = useRef<object | undefined>(undefined);

  const explicitSessionSelectionRef = useRef<string | undefined>(undefined);

  const locallyCreatedSessionsRef = useRef<Map<string, number>>(new Map());

  const suppressedPendingRequestIdsRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => { currentSessionIdRef.current = currentSessionId; });

  return { currentSessionId, setCurrentSessionId, pendingPermissionsBySession, setPendingPermissionsBySession, pendingQuestionsBySession, setPendingQuestionsBySession, isBootstrappingChat, setIsBootstrappingChat, activeSessionsVisible, setActiveSessionsVisible, currentSessionIdRef, pendingDeepLinkTargetRef, deepLinkOperationRef, bootstrapPromiseRef, bootstrapTokenRef, explicitSessionSelectionRef, locallyCreatedSessionsRef, suppressedPendingRequestIdsRef };
}
