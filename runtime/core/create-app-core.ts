import { createServerQueryClient } from '@/shared/server-data/query-client';
import { createConnectionRegistry } from '@/runtime/connections/registry';
import type { CommandContext } from './commands/context';
import { createWorkspaceCommands } from './commands/workspace';
import { createSessionCommands } from './commands/session';
import { createPromptCommands } from './commands/prompt';
import { createConnectionCommands } from './commands/connection';
import { createAutoApproval } from './commands/auto-approval';
import { createCoreEvents } from './events';

import { createAppStore, type AppStoreDefaults } from './store';

export type AppCore = CommandContext & {
  events: ReturnType<typeof createCoreEvents>;
  autoApproval: ReturnType<typeof createAutoApproval>;
  commands: {
    workspace: ReturnType<typeof createWorkspaceCommands>;
    session: ReturnType<typeof createSessionCommands>;
    prompt: ReturnType<typeof createPromptCommands>;
    connection: ReturnType<typeof createConnectionCommands>;
  };
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
  const workspace = createWorkspaceCommands(context);
  const session = createSessionCommands(context);
  return { ...context, events: createCoreEvents(context), autoApproval: createAutoApproval(context, session.interactions), commands: {
    workspace, session, prompt: createPromptCommands(context),
    connection: createConnectionCommands(context, workspace),
  } };
}
