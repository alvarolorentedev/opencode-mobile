import type { NetworkStatus } from '@/lib/network-status';
import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import type { ProjectWorktree } from '@/lib/opencode/project';
import type { Session, SessionStatus } from '@/lib/opencode/types';
import type { ChatPreferences } from '@/providers/opencode-preferences';
import type { ConnectionContextValue } from '@/providers/opencode-provider-types';
import type { createSharedEventStream } from '@/providers/shared-event-stream';
import type { useOpencodeProviderComposition } from '@/providers/use-opencode-provider-composition';
import type { WorkspaceShellState } from '@/providers/use-workspace-shell-state';
import type { Dispatch, SetStateAction } from 'react';

export type WorkspaceTarget = { connectionId: string; projectPath: string };
export type SessionTarget = WorkspaceTarget & { sessionId: string };
export type NewWorktreeChatTarget = { connectionId: string; projectRoot: string; name?: string };
export type NewWorktreeChatResult = { session?: Session; checkout?: ProjectWorktree; error?: string };
export const workspaceKey = ({ connectionId, projectPath }: WorkspaceTarget) => JSON.stringify([connectionId, projectPath]);
export const sessionKey = (target: SessionTarget) => JSON.stringify([target.connectionId, target.projectPath, target.sessionId]);
export type ConnectionRecord = {
  id: string;
  revision?: number;
  authRevision?: number;
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
export type SharedWorkspaceState = Pick<WorkspaceShellState,
  'controlPlaneUrl' | 'setControlPlaneUrl' | 'onboardingVersion' | 'setOnboardingVersion' |
  'onboardingActive' | 'setOnboardingActive' | 'lastSessionByConnection' | 'setLastSessionByConnection' |
  'favoriteSessions' | 'setFavoriteSessions' | 'projectPathsByConnection' | 'setProjectPathsByConnection' | 'projectPathsByConnectionRef'> & { fileClipboard?: import('./use-file-clipboard').FileClipboard };
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
