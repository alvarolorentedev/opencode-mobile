import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

describe('prompt inbox refresh', () => {
  it('skips the inbox for a targeted message reconcile but reads it for a page', async () => {
    const runtime = hookRuntime();
    const inbox = vi.fn(async () => []);
    const notices = vi.fn(async () => []);
    const readMessages = vi.fn(async () => []);
    const { usePromptInbox } = await loadTs('features/chat/state/use-prompt-inbox.ts', {
      react: runtime.react,
      '@/shared/protocol/services/session-service': { getSessionInbox: inbox, getSessionNotices: notices, submitLegacyPrompt: async () => undefined },
      '@/shared/protocol/opencode/client/errors': { classifyConnectionFailure: () => 'unknown' },
      '@/shared/utilities/error-message': { getErrorMessage: (error: unknown) => String(error) },
    });
    const value = runtime.mount(() => usePromptInbox({
      client: { __opencode: { contract: 'v2', directory: '/workspace' }, promptInbox: {} } as never,
      queueScope: 'scope',
      isCurrentClient: () => true,
      refreshMessages: readMessages,
    }), {});

    await value.refreshMessages('s', true, { messageId: 'm1' });
    expect(readMessages).toHaveBeenCalledWith('s', true, { messageId: 'm1' });
    expect(inbox).not.toHaveBeenCalled();

    await value.refreshMessages('s', true);
    expect(inbox).toHaveBeenCalledOnce();
    expect(readMessages).toHaveBeenCalledTimes(2);
    runtime.unmount();
  });
});
