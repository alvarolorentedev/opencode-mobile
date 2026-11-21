import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { useAppCore, useAppStore } from '@/runtime/core/context';
import type { ShellState } from '@/runtime/core/store';

// Project and session identity comes from the server catalogs. The shell keeps
// only device-local concerns: connection settings, preferences, favorites
// (the server has no favorite flag), hidden project markers, and onboarding.
export function useWorkspaceShellState() {
  const { store } = useAppCore();
  const shell = useAppStore((state) => state.shell);
  const write = useCallback(<K extends keyof ShellState>(key: K, value: SetStateAction<ShellState[K]>) => {
    store.getState().setShellValue(key, value as ShellState[K] | ((current: ShellState[K]) => ShellState[K]));
  }, [store]);

  const setSettings = useCallback<Dispatch<SetStateAction<ShellState['settings']>>>(
    (value) => write('settings', value), [write]);
  const setControlPlaneUrl = useCallback<Dispatch<SetStateAction<ShellState['controlPlaneUrl']>>>(
    (value) => write('controlPlaneUrl', value), [write]);
  const setOnboardingVersion = useCallback<Dispatch<SetStateAction<ShellState['onboardingVersion']>>>(
    (value) => write('onboardingVersion', value), [write]);
  const setOnboardingActive = useCallback<Dispatch<SetStateAction<ShellState['onboardingActive']>>>(
    (value) => write('onboardingActive', value), [write]);
  const setChatPreferences = useCallback<Dispatch<SetStateAction<ShellState['chatPreferences']>>>(
    (value) => write('chatPreferences', value), [write]);
  const setFavoriteSessions = useCallback<Dispatch<SetStateAction<ShellState['favoriteSessions']>>>(
    (value) => write('favoriteSessions', value), [write]);
  const setHiddenProjects = useCallback<Dispatch<SetStateAction<ShellState['hiddenProjects']>>>(
    (value) => write('hiddenProjects', value), [write]);

  return {
    ...shell,
    setSettings,
    setControlPlaneUrl,
    setOnboardingVersion,
    setOnboardingActive,
    setChatPreferences,
    setFavoriteSessions,
    setHiddenProjects,
  };
}
export type WorkspaceShellState = ReturnType<typeof useWorkspaceShellState>;
