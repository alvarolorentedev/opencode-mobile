import { createServerQueryClient } from '@/shared/server-data/query-client';
import { createConnectionRegistry } from '@/runtime/connections/registry';

import { createAppStore, type AppStoreDefaults } from './store';

export type AppCore = {
  store: ReturnType<typeof createAppStore>;
  queryClient: ReturnType<typeof createServerQueryClient>;
  connections: ReturnType<typeof createConnectionRegistry>;
};

// The only app-level composition root. React mounts this once; features read
// it through selectors instead of receiving state through providers. Defaults
// are injected so tests and the app share the same constructor.
export function createAppCore(defaults: AppStoreDefaults): AppCore {
  const store = createAppStore(defaults);
  const queryClient = createServerQueryClient();
  return {
    store,
    queryClient,
    connections: createConnectionRegistry({ store, queryClient }),
  };
}
