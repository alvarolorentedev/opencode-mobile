import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core';

// The active project is per retained workspace, not per screen. Keeping it in
// the app store makes project navigation synchronous and survives a rerender
// without a ref mirror.
export function useProjectRuntimeState(scopeKey: string, projectPath?: string) {
  const { store } = useAppCore();
  const stored = useAppStore((state) => state.selection[scopeKey]?.activeProjectPath);
  const activeProjectPath = stored ?? projectPath;
  const setActiveProjectPath = useCallback<Dispatch<SetStateAction<string | undefined>>>((value) => {
    store.getState().setSelection(scopeKey, (current) => ({
      activeProjectPath: typeof value === 'function'
        ? value(current.activeProjectPath ?? projectPath)
        : value,
    }));
  }, [projectPath, scopeKey, store]);

  const activeProjectPathRef = useRef(activeProjectPath);
  useLayoutEffect(() => { activeProjectPathRef.current = activeProjectPath; });

  const projectFileRequestRef = useRef(0);
  return { activeProjectPath, setActiveProjectPath, activeProjectPathRef, projectFileRequestRef };
}
