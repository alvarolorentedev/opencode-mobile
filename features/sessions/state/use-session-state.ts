import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';

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

  const currentSessionIdRef = useMemo(() => ({ get current() { return store.getState().selection[scopeKey]?.currentSessionId; } }), [scopeKey, store]);

  const pendingDeepLinkTargetRef = useMemo(() => ({
    get current() { return store.getState().selection[scopeKey]?.pendingDeepLink; },
    set current(pendingDeepLink: SelectionState['pendingDeepLink']) { write({ pendingDeepLink }); },
  }), [scopeKey, store, write]);

  const explicitSessionSelectionRef = useMemo(() => ({
    get current() { return store.getState().selection[scopeKey]?.explicitSessionId; },
    set current(explicitSessionId: string | undefined) { write({ explicitSessionId }); },
  }), [scopeKey, store, write]);

  return { currentSessionId, setCurrentSessionId, isBootstrappingChat, currentSessionIdRef, pendingDeepLinkTargetRef, explicitSessionSelectionRef };
}
