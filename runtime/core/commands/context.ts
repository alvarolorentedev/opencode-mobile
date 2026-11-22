import type { QueryClient } from '@tanstack/react-query';

import type { createConnectionRegistry } from '@/runtime/connections/registry';
import type { AppStore } from '@/runtime/core/store';

export type CommandContext = {
  store: AppStore;
  queryClient: QueryClient;
  connections: ReturnType<typeof createConnectionRegistry>;
  clock: () => number;
};
