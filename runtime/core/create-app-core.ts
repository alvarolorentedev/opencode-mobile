import { createServerQueryClient } from '@/shared/server-data/query-client';
import { createConnectionRegistry } from '@/runtime/connections/registry';
import type { CommandContext } from './commands/context';
import { createWorkspaceCommands } from './commands/workspace';
import { createSessionCommands } from './commands/session';

import { createAppStore, type AppStoreDefaults } from './store';

export type AppCore = CommandContext & {
  commands: { workspace: ReturnType<typeof createWorkspaceCommands>; session: ReturnType<typeof createSessionCommands> };
};

// The only app-level composition root. React mounts this once; features read
// it through selectors instead of receiving state through providers. Defaults
// are injected so tests and the app share the same constructor.
export function createAppCore(defaults: AppStoreDefaults): AppCore {
  const store = createAppStore(defaults);
  const queryClient = createServerQueryClient();
  const context: CommandContext = {
    store,
    queryClient,
    connections: createConnectionRegistry({ store, queryClient }),
    clock: () => Date.now(),
  };
  return { ...context, commands: { workspace: createWorkspaceCommands(context), session: createSessionCommands(context) } };
}
