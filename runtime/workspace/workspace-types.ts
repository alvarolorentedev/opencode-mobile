import type { NetworkStatus } from '@/shared/network/network-status';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import type { ConnectionContextValue } from '@/features/connections/index';

import type { useOpencodeProviderComposition } from '@/runtime/composition/use-opencode-provider-composition';

import type { WorkspaceShellState } from '@/runtime/workspace/use-workspace-shell-state';

import type { Dispatch, SetStateAction } from 'react';

import type { ConnectionRecord } from '@/shared/contracts/workspace';

export type SharedWorkspaceState = Pick<WorkspaceShellState,
  'controlPlaneUrl' | 'setControlPlaneUrl' | 'onboardingVersion' | 'setOnboardingVersion' |
  'onboardingActive' | 'setOnboardingActive' | 'lastSessionByConnection' | 'setLastSessionByConnection' |
  'favoriteSessions' | 'setFavoriteSessions' | 'projectPathsByConnection' | 'setProjectPathsByConnection' | 'projectPathsByConnectionRef'> & { fileClipboard?: import('@/features/projects/index').FileClipboard };

export type WorkspaceRuntimeInput = {
  connection: ConnectionRecord;
  switchConnection: ConnectionContextValue['switchConnection'];
  projectPath?: string;
  preferences: ChatPreferences;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
  setSettings: Dispatch<SetStateAction<OpencodeConnectionSettings>>;
  shared: SharedWorkspaceState;
  network: NetworkStatus;
  connectSetup: ConnectionContextValue['connectSetup'];
  connectionProfiles: ConnectionContextValue['connectionProfiles'];
  servicesValue: ConnectionContextValue['services'];
  isHydrated: boolean;
  visible: boolean;
  isConnectionOwner: boolean;
};

export type WorkspaceSnapshot = ReturnType<typeof useOpencodeProviderComposition>;

export type WorkspaceValues = WorkspaceSnapshot['values'];
