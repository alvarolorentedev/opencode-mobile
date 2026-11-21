import { createServerQueryClient } from '@/shared/server-data/query-client';

import { createAppStore, type AppStoreDefaults } from './store';

export type AppCore = {
  store: ReturnType<typeof createAppStore>;
  queryClient: ReturnType<typeof createServerQueryClient>;
};

// The only app-level composition root. React mounts this once; features read
// it through selectors instead of receiving state through providers. Defaults
// are injected so tests and the app share the same constructor.
export function createAppCore(defaults: AppStoreDefaults): AppCore {
  return {
    store: createAppStore(defaults),
    queryClient: createServerQueryClient(),
  };
}
