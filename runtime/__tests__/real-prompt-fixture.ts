import { QueryClient } from '@tanstack/react-query';
import { vi } from 'vitest';

import type { PromptCommandInput } from '@/features/chat/runtime';
import { createPromptCommands } from '@/runtime/core/commands/prompt';
import { createAppStore } from '@/runtime/core/store';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import { settleReact } from '../../tests/helpers/controlled-clock';

export function promptFixture(overrides: Partial<PromptCommandInput>, scopeKey = 'submission-scope') {
  const settingsRef = { current: { serverUrl: 'http://server', username: '', password: '', directory: '/repo' } };
  const api = { session: { interrupt: async () => {}, switchModel: vi.fn(async () => {}) } };
  const client = {
    __opencode: { contract: 'v2', directory: '/repo' },
    api,
  } as unknown as ScopedOpencodeClient;
  const currentClient = { current: client };
  const store = createAppStore({ settings: settingsRef.current, chatPreferences: defaultChatPreferences, controlPlaneUrl: '' });
  const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const workspace = createPromptCommands({ store, queryClient: cache, clock: Date.now }).workspace(scopeKey);
  const input: PromptCommandInput = {
    client, isCurrentClient: (candidate) => candidate === currentClient.current,
    connectionScope: getConnectionScope(settingsRef.current), readSettings: () => settingsRef.current,
    sessions: [{ id: 's', title: 'chat' }] as PromptCommandInput['sessions'],
    availableAgents: [{ id: 'build', label: 'Build', mode: 'primary' }], availableModels: [], availableProviders: [],
    sessionStatuses: {}, messagesBySession: {}, chatPreferences: defaultChatPreferences,
    submitPrompt: async () => undefined, refreshSessions: async () => {}, setSessions: () => {},
    refreshSessionDiff: async () => {}, refreshSessionTodos: async () => {}, scheduleSessionRefresh: () => {},
    ...overrides,
  };
  let current = input;
  const submission = { get current() { return store.getState().prompt[scopeKey]?.sending ?? { active: false }; } };
  return {
    store, scopeKey, settingsRef, currentClient, input, submission, api,
    runtime: {
      get value() {
        const state = store.getState().prompt[scopeKey];
        return { ...workspace.actions(current), sendingState: submission.current, promptError: state?.error };
      },
      update(patch: Partial<PromptCommandInput>) { current = { ...current, ...patch }; },
      settle: settleReact,
      unmount() { workspace.reset(); cache.clear(); },
    },
  };
}
