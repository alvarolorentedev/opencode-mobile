import type { QueryClient } from '@tanstack/react-query';

import type { createPromptCommands as CreatePromptCommands } from '@/runtime/core/commands/prompt';
import { createAppStore, type AppState, type AppStore } from '@/runtime/core/store';
import { createServerQueryClient } from '@/shared/server-data/query-client';

import { queryRuntime } from '../../tests/helpers/query-runtime.mjs';
import { loadTs, type hookRuntime } from '../../tests/helpers/runtime.mjs';

type Runtime = ReturnType<typeof hookRuntime>;

function createStore() {
  return createAppStore({
    settings: { serverUrl: 'http://server', username: '', password: '', directory: '' },
    chatPreferences: {} as never, controlPlaneUrl: '',
  });
}

async function commandsFor(store: AppStore, queryClient: QueryClient, chat: Record<string, unknown>, globals?: Record<string, unknown>) {
  const { createPromptCommands } = await loadTs('runtime/core/commands/prompt.ts', { '@/features/chat/runtime': chat }, globals);
  return (createPromptCommands as typeof CreatePromptCommands)({ store, queryClient, clock: Date.now });
}

function coreImports(runtime: Runtime, store: AppStore, prompt: ReturnType<typeof CreatePromptCommands>) {
  const commands = { prompt };
  return {
    react: runtime.react,
    '@/runtime/core': {
      useAppCore: () => ({ store, commands }),
      useAppStore: <T>(select: (state: AppState) => T) =>
        runtime.react.useSyncExternalStore(store.subscribe, () => select(store.getState())),
    },
  };
}

export async function fixturePromptCommands(store: AppStore, imports: Record<string, unknown>, globals?: Record<string, unknown>) {
  const chat = await loadTs(['features/chat/services/prompt-submission.ts', 'features/chat/services/prompt-settlement.ts'], imports, globals);
  return commandsFor(store, createServerQueryClient(), chat, globals);
}

export async function loadPromptLifecycle(runtime: Runtime, imports: Record<string, unknown>) {
  const store = createStore();
  const prompt = await fixturePromptCommands(store, imports, runtime.globals);
  const { usePromptLifecycle } = await loadTs('features/chat/state/use-prompt-lifecycle.ts', {
    ...imports, ...coreImports(runtime, store, prompt),
  }, runtime.globals);
  return { usePromptLifecycle, store };
}

export async function createFixtureInbox(runtime: Runtime, imports: Record<string, unknown>) {
  const store = createStore();
  const query = queryRuntime(runtime.react);
  const inbox = await loadTs('features/chat/services/prompt-inbox-commands.ts', imports, runtime.globals);
  const prompt = await commandsFor(store, query.useQueryClient() as unknown as QueryClient, inbox, runtime.globals);
  return { store, query, inbox, prompt };
}

export async function loadPromptInbox(runtime: Runtime, imports: Record<string, unknown>) {
  const { store, query, inbox, prompt } = await createFixtureInbox(runtime, imports);
  return loadTs('features/chat/state/use-prompt-inbox.ts', {
    ...imports, ...coreImports(runtime, store, prompt), '@tanstack/react-query': query,
    '../services/prompt-inbox-commands': inbox,
  }, runtime.globals);
}
