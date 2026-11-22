import type { NetworkStatus } from '@/shared/network/network-status';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import type { CapabilitiesContextValue } from '@/features/ai/index';
import type { ChatContextValue } from '@/features/chat/index';
import type { ProjectsContextValue } from '@/features/projects/index';
import type { useProjectCatalogActions } from '@/features/projects/runtime';
import type { ActiveSessionItem } from '@/features/sessions/index';
import type { ConversationContextValue } from '@/features/voice/index';
import type { useWidgetState } from '@/features/widgets/runtime';

import type { Dispatch, SetStateAction } from 'react';

import type { ConnectionRecord, WorkspaceCatalog } from '@/shared/contracts/workspace';

export type ProjectBindingInput = {
  connection: ConnectionRecord;
  catalog?: WorkspaceCatalog;
  projectPath?: string;
  preferences: ChatPreferences;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
  setSettings: Dispatch<SetStateAction<OpencodeConnectionSettings>>;
  network: NetworkStatus;
  isHydrated: boolean;
  visible: boolean;
  demanded: boolean;
  isConnectionOwner: boolean;
};

export type WorkspaceSnapshot = {
  boundDirectory?: string;
  revision?: number;
  enabled: boolean;
  values: WorkspaceValues;
  busy: boolean;
  suspend: () => void;
  sessionPreviews: Record<string, string>;
  loadProjectCatalog: ReturnType<typeof useProjectCatalogActions>['loadProjectCatalog'];
  native: Omit<Parameters<typeof useWidgetState>[0], 'hydrated' | 'connected' | 'showPreviews' | 'language' | 'currentSessionId'> & {
    activeSessions: ActiveSessionItem[];
  };
};

export type WorkspaceValues = {
  capabilitiesValue: CapabilitiesContextValue;
  projectsValue: Pick<ProjectsContextValue, 'addProject' | 'refreshProjectCatalog'>;
  chatValue: ChatContextValue;
  conversationValue: ConversationContextValue;
};
