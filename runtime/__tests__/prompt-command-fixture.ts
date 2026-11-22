import type { createPromptCommands as CreatePromptCommands } from '@/runtime/core/commands/prompt';
import { createAppStore, type AppState, type AppStore } from '@/runtime/core/store';

import { loadTs, type hookRuntime } from '../../tests/helpers/runtime.mjs';

export async function fixturePromptCommands(store: AppStore, imports: Record<string, unknown>, globals?: Record<string, unknown>) {
  const submission = await loadTs('features/chat/services/prompt-submission.ts', imports, globals);
  const { createPromptCommands } = await loadTs('runtime/core/commands/prompt.ts', {
    ...imports,
    '@/features/chat/runtime': submission,
  }, globals);
  return (createPromptCommands as typeof CreatePromptCommands)({ store, clock: Date.now });
}

export async function loadPromptLifecycle(runtime: ReturnType<typeof hookRuntime>, imports: Record<string, unknown>) {
  const store = createAppStore({
    settings: { serverUrl: 'http://server', username: '', password: '', directory: '' },
    chatPreferences: {} as never, controlPlaneUrl: '',
  });
  const commands = { prompt: await fixturePromptCommands(store, imports, runtime.globals) };
  const { usePromptLifecycle } = await loadTs('features/chat/state/use-prompt-lifecycle.ts', {
    ...imports,
    react: runtime.react,
    '@/runtime/core': {
      useAppCore: () => ({ store, commands }),
      useAppStore: <T>(select: (state: AppState) => T) =>
        runtime.react.useSyncExternalStore(store.subscribe, () => select(store.getState())),
    },
  }, runtime.globals);
  return { usePromptLifecycle, store };
}
