import { getConnectControlPlanes } from '@/shared/contracts/cloud-link';
import { defaultConnectionSettings } from '@/shared/protocol/opencode/client';
import { useState } from 'react';
import { defaultChatPreferences, type ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { FavoriteSession, HiddenProjectsByConnection } from '@/shared/contracts/domain';

// Project and session identity comes from the server catalogs. The shell keeps
// only device-local concerns: connection settings, preferences, favorites
// (the server has no favorite flag), hidden project markers, and onboarding.
export function useWorkspaceShellState() {
  const [settings, setSettings] = useState(defaultConnectionSettings);
  const [controlPlaneUrl, setControlPlaneUrl] = useState(() => getConnectControlPlanes()[0] ?? '');
  const [onboardingVersion, setOnboardingVersion] = useState(0);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(defaultChatPreferences);
  const [favoriteSessions, setFavoriteSessions] = useState<FavoriteSession[]>([]);
  const [hiddenProjects, setHiddenProjects] = useState<HiddenProjectsByConnection>({});
  return { settings, setSettings, controlPlaneUrl, setControlPlaneUrl,
    onboardingVersion, setOnboardingVersion, onboardingActive, setOnboardingActive, chatPreferences, setChatPreferences,
    favoriteSessions, setFavoriteSessions, hiddenProjects, setHiddenProjects };
}
export type WorkspaceShellState = ReturnType<typeof useWorkspaceShellState>;
