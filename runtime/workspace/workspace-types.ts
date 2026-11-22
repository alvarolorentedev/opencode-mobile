import type { NetworkStatus } from '@/shared/network/network-status';

import type { OpencodeConnectionSettings, ScopedOpencodeClient } from '@/shared/protocol/opencode/client';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import type { CapabilitiesContextValue } from '@/features/ai/index';
import type { ChatContextValue } from '@/features/chat/index';
import type { ConnectionContextValue } from '@/features/connections/index';
import type { ProjectFilesContextValue, ProjectsContextValue } from '@/features/projects/index';
import type { useProjectCatalogActions } from '@/features/projects/runtime';
import type { ActiveSessionItem, CurrentSessionContextValue, SessionLibraryContextValue } from '@/features/sessions/index';
import type { ConversationContextValue } from '@/features/voice/index';
import type { useWidgetState } from '@/features/widgets/runtime';
import type { Session, SessionStatus } from '@/shared/protocol/opencode/types';

import type { WorkspaceShellState } from '@/runtime/workspace/use-workspace-shell-state';

import type { Dispatch, SetStateAction } from 'react';

import type { ConnectionRecord, WorkspaceCatalog } from '@/shared/contracts/workspace';

export type SharedWorkspaceState = Pick<WorkspaceShellState,
  'controlPlaneUrl' | 'setControlPlaneUrl' |
  'favoriteSessions' | 'setFavoriteSessions' | 'hiddenProjects' | 'setHiddenProjects'> & { fileClipboard?: import('@/features/projects/index').FileClipboard };

export type ProjectBindingInput = {
  connection: ConnectionRecord;
  catalog?: WorkspaceCatalog;
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
  demanded: boolean;
  isConnectionOwner: boolean;
};

export type WorkspaceSnapshot = {
  libraryVisible: boolean;
  revision?: number;
  enabled: boolean;
  values: WorkspaceValues;
  busy: boolean;
  suspend: () => void;
  catalogClient: ScopedOpencodeClient;
  catalogSessions: Session[];
  catalogStatuses: Record<string, SessionStatus>;
  loadProjectCatalog: ReturnType<typeof useProjectCatalogActions>['loadProjectCatalog'];
  native: Omit<Parameters<typeof useWidgetState>[0], 'hydrated' | 'connected' | 'showPreviews' | 'language'> & {
    activeSessions: ActiveSessionItem[];
  };
};

export type WorkspaceValues = {
  connectionValue: ConnectionContextValue;
  capabilitiesValue: CapabilitiesContextValue;
  projectsValue: ProjectsContextValue;
  projectFilesValue: ProjectFilesContextValue;
  currentSessionValue: CurrentSessionContextValue;
  sessionLibraryValue: SessionLibraryContextValue;
  chatValue: ChatContextValue;
  conversationValue: ConversationContextValue;
};
