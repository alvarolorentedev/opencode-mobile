import { getConnectControlPlanes } from '@/lib/connect';
import { defaultConnectionSettings } from '@/lib/opencode/client';
import { useLayoutEffect, useRef, useState } from 'react';
import { defaultChatPreferences, type ChatPreferences } from './opencode-preferences';
import type { FavoriteSession, ProjectPathsByConnection } from './opencode-provider-types';

export function useWorkspaceShellState() {
  const [settings, setSettings] = useState(defaultConnectionSettings);
  const [controlPlaneUrl, setControlPlaneUrl] = useState(() => getConnectControlPlanes()[0] ?? '');
  const [activeProjectPath, setActiveProjectPath] = useState<string>();
  const [onboardingVersion, setOnboardingVersion] = useState(0);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(defaultChatPreferences);
  const [lastSessionByConnection, setLastSessionByConnection] = useState<Record<string, Record<string, string>>>({});
  const [favoriteSessions, setFavoriteSessions] = useState<FavoriteSession[]>([]);
  const [projectPathsByConnection, setProjectPathsByConnection] = useState<ProjectPathsByConnection>({});
  const projectPathsByConnectionRef = useRef(projectPathsByConnection);
  useLayoutEffect(() => { projectPathsByConnectionRef.current = projectPathsByConnection; });
  return { settings, setSettings, controlPlaneUrl, setControlPlaneUrl, activeProjectPath, setActiveProjectPath,
    onboardingVersion, setOnboardingVersion, onboardingActive, setOnboardingActive, chatPreferences, setChatPreferences,
    lastSessionByConnection, setLastSessionByConnection, favoriteSessions, setFavoriteSessions,
    projectPathsByConnection, setProjectPathsByConnection, projectPathsByConnectionRef };
}
export type WorkspaceShellState = ReturnType<typeof useWorkspaceShellState>;
