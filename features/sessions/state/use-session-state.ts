import { useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';

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
  const activeSessionsVisible = selection.activeSessionsVisible;
  const setActiveSessionsVisible = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    write((current) => ({ activeSessionsVisible: typeof value === 'function' ? value(current.activeSessionsVisible) : value }));
  }, [write]);

  const currentSessionIdRef = useMemo(() => ({ get current() { return store.getState().selection[scopeKey]?.currentSessionId; } }), [scopeKey, store]);

  const pendingDeepLinkTargetRef = useMemo(() => ({
    get current() { return store.getState().selection[scopeKey]?.pendingDeepLink; },
    set current(pendingDeepLink: SelectionState['pendingDeepLink']) { write({ pendingDeepLink }); },
  }), [scopeKey, store, write]);

  const deepLinkOperationRef = useRef<object | undefined>(undefined);

  const explicitSessionSelectionRef = useMemo(() => ({
    get current() { return store.getState().selection[scopeKey]?.explicitSessionId; },
    set current(explicitSessionId: string | undefined) { write({ explicitSessionId }); },
  }), [scopeKey, store, write]);

  // Request correlation while a new session waits to appear in the catalog.
  const locallyCreatedSessionsRef = useRef<Map<string, number>>(new Map());

  return { currentSessionId, setCurrentSessionId, isBootstrappingChat, activeSessionsVisible, setActiveSessionsVisible, currentSessionIdRef, pendingDeepLinkTargetRef, deepLinkOperationRef, explicitSessionSelectionRef, locallyCreatedSessionsRef };
}
