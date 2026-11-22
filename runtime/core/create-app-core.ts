import { createServerQueryClient } from '@/shared/server-data/query-client';
import { createConnectionRegistry } from '@/runtime/connections/registry';
import { createFileClipboard, invalidateProjectFileReads } from '@/features/projects/runtime';
import { cachedTranscriptView } from '@/features/chat/runtime';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { QueryIdentity } from '@/shared/server-data/keys';
import type { CommandContext } from './commands/context';
import { createWorkspaceCommands } from './commands/workspace';
import { createSessionCommands } from './commands/session';
import { createPromptCommands } from './commands/prompt';
import { createConnectionCommands } from './commands/connection';
import { createAutoApproval } from './commands/auto-approval';
import { createTerminalRuntime } from './commands/terminal';
import { createCoreEvents } from './events';
import { createVoiceControls } from './voice-controls';
import { createProjectRuntimes } from './project-runtimes';

import { createAppStore, type AppStoreDefaults } from './store';
import { createConnectionSettingsPersistence } from '@/runtime/persistence/connection-settings';
import { createDevicePreferences } from '@/runtime/persistence/device-preferences';

export type AppCore = CommandContext & {
  events: ReturnType<typeof createCoreEvents>;
  autoApproval: ReturnType<typeof createAutoApproval>;
  terminal: ReturnType<typeof createTerminalRuntime>;
  clipboard: ReturnType<typeof createFileClipboard>;
  voice: ReturnType<typeof createVoiceControls>;
  projects: ReturnType<typeof createProjectRuntimes>;
  persistence: { hydrate: () => Promise<void>; observeSettings: () => () => void; flushPreferences: () => Promise<void> };
  transcripts: (identity: QueryIdentity, client: ScopedOpencodeClient) => ReturnType<typeof cachedTranscriptView>;
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
  const preferences = createDevicePreferences();
  const connectionSettings = createConnectionSettingsPersistence();
  const store = createAppStore(defaults, preferences.options);
  let hydration: Promise<void> | undefined;
  const persistence = {
    hydrate: () => hydration ??= connectionSettings.hydrate(defaults.settings).then((settings) => {
      store.getState().setShellValue('settings', settings);
      return store.persist.rehydrate();
    }),
    observeSettings: () => connectionSettings.observe(store),
    flushPreferences: preferences.flush,
  };
  const queryClient = createServerQueryClient();
  const context: CommandContext = {
    store,
    queryClient,
    connections: createConnectionRegistry({ store, queryClient }),
    clock: () => Date.now(),
  };
  const session = createSessionCommands(context);
  const prompt = createPromptCommands(context);
  const events = createCoreEvents(context);
  const terminal = createTerminalRuntime(context);
  const voice = createVoiceControls();
  const workspace = createWorkspaceCommands(context, session, voice.pause);
  const clipboard = createFileClipboard(store, async (id, root) => {
    const access = context.connections.get(id)?.getProjectAccess(root);
    if (access?.isCurrent()) await invalidateProjectFileReads(queryClient, access.identity, access.client);
  });
  const projects = createProjectRuntimes({ ...context, events, terminal, session, prompt });
  return { ...context, events, autoApproval: createAutoApproval(context, session.interactions), terminal,
    clipboard, voice, projects, persistence, transcripts: (identity, client) => cachedTranscriptView(queryClient, identity, client), commands: {
    workspace, session, prompt,
    connection: createConnectionCommands(context, workspace),
  } };
}
