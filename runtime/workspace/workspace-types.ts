import type { NetworkStatus } from '@/shared/network/network-status';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

import type { CapabilitiesContextValue } from '@/features/ai/index';
import type { ProjectsContextValue } from '@/features/projects/index';
import type { useProjectCatalogActions } from '@/features/projects/runtime';

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
};

export type WorkspaceValues = {
  modelRouting: CapabilitiesContextValue['modelRouting'];
  projectsValue: Pick<ProjectsContextValue, 'addProject' | 'refreshProjectCatalog'>;
};
