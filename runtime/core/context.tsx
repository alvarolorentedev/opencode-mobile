import { createContext, useContext, type PropsWithChildren } from 'react';
import { useStore } from 'zustand';

import type { AppCore } from '@/runtime/core/create-app-core';
import type { AppState } from '@/runtime/core/store';

const AppCoreContext = createContext<AppCore | null>(null);

export function AppCoreProvider({ core, children }: PropsWithChildren<{ core: AppCore }>) {
  return <AppCoreContext.Provider value={core}>{children}</AppCoreContext.Provider>;
}

export function useAppCore() {
  const core = useContext(AppCoreContext);
  if (!core) throw new Error('The app core requires AppCoreProvider.');
  return core;
}

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(useAppCore().store, selector);
}
