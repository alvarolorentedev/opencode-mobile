import type { Dispatch, SetStateAction } from 'react';
import type { NetworkStatus } from '@/lib/network-status';
import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import type { Session, SessionStatus } from '@/lib/opencode/types';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { ConnectionContextValue } from '@/providers/opencode-provider-types';
import type { OpencodeProviderState } from '@/providers/use-opencode-provider-state';
import type { useOpencodeProviderComposition } from '@/providers/use-opencode-provider-composition';
import type { createSharedEventStream } from '@/providers/shared-event-stream';

export type WorkspaceTarget = { connectionId: string; projectPath: string };
export type SessionTarget = WorkspaceTarget & { sessionId: string };
export const workspaceKey = ({ connectionId, projectPath }: WorkspaceTarget) => JSON.stringify([connectionId, projectPath]);
export const sessionKey = (target: SessionTarget) => JSON.stringify([target.connectionId, target.projectPath, target.sessionId]);
export type ConnectionRecord = {
  id: string;
  name: string;
  settings: OpencodeConnectionSettings;
  enabled: boolean;
  preferences: Partial<ChatPreferences>;
  projects: string[];
  events: ReturnType<typeof createSharedEventStream>;
};
export type WorkspaceCatalog = {
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  refresh: () => Promise<void>;
  removeSession: (sessionId: string) => void;
};
export type SharedWorkspaceState = Pick<OpencodeProviderState,
  'controlPlaneUrl' | 'setControlPlaneUrl' | 'onboardingVersion' | 'setOnboardingVersion' |
  'onboardingActive' | 'setOnboardingActive' | 'lastSessionByConnection' | 'setLastSessionByConnection' |
  'favoriteSessions' | 'setFavoriteSessions' | 'projectPathsByConnection' | 'setProjectPathsByConnection' | 'projectPathsByConnectionRef'>;
export type WorkspaceRuntimeInput = {
  connection: ConnectionRecord;
  projectPath?: string;
  preferences: ChatPreferences;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
  setSettings: Dispatch<SetStateAction<OpencodeConnectionSettings>>;
  shared: SharedWorkspaceState;
  network: NetworkStatus;
  catalog?: WorkspaceCatalog;
  onCatalog: (connectionId: string, catalog: WorkspaceCatalog) => void;
  connectSetup: ConnectionContextValue['connectSetup'];
  connectionProfiles: ConnectionContextValue['connectionProfiles'];
  servicesValue: ConnectionContextValue['services'];
  isHydrated: boolean;
  visible: boolean;
  isConnectionOwner: boolean;
};
export type WorkspaceSnapshot = ReturnType<typeof useOpencodeProviderComposition>;
export type WorkspaceValues = WorkspaceSnapshot['values'];
