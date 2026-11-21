import { describe, expect, it } from 'vitest';

import { createAppCore } from '@/runtime/core/create-app-core';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

describe('app core', () => {
  it('constructs one store and one query cache with injected defaults', async () => {
    const core = createAppCore({
      settings: { serverUrl: 'http://127.0.0.1:4096', username: '', password: '', directory: '' },
      chatPreferences: {} as ChatPreferences,
      controlPlaneUrl: '',
    });

    core.store.getState().setRegistry({ ready: true });
    core.store.getState().setSelection('["c","/p"]', { currentSessionId: 's' });
    expect(core.store.getState().registry.ready).toBe(true);
    expect(core.store.getState().selection['["c","/p"]'].currentSessionId).toBe('s');

    await core.queryClient.fetchQuery({ queryKey: ['probe'], queryFn: async () => 42 });
    expect(core.queryClient.getQueryData(['probe'])).toBe(42);
  });
});
