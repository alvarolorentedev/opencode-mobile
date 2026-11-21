import { getConnectControlPlanes } from '@/shared/contracts/cloud-link';
import { createServerQueryClient } from '@/shared/server-data/client';
import { defaultConnectionSettings } from '@/shared/protocol/opencode/client';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';

import { createAppStore } from './store';

export type AppCore = {
  store: ReturnType<typeof createAppStore>;
  queryClient: ReturnType<typeof createServerQueryClient>;
};

// The only app-level composition root. React mounts this once; features read
// it through selectors instead of receiving state through providers.
export function createAppCore(): AppCore {
  return {
    store: createAppStore({
      settings: defaultConnectionSettings,
      chatPreferences: defaultChatPreferences,
      controlPlaneUrl: getConnectControlPlanes()[0] ?? '',
    }),
    queryClient: createServerQueryClient(),
  };
}
