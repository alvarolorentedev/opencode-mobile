import type { NetworkStatus } from '@/shared/network/network-status';

import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';

import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';


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
