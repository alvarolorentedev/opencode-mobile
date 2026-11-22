import { onTestFinished } from 'vitest';

import { createPromptInboxCommands, EMPTY_OUTBOX, EMPTY_SNAPSHOT, mergePromptOutbox, type PromptSnapshot } from '@/features/chat/services/prompt-inbox-commands';
import { promptInboxKey } from '@/features/chat/services/queries';
import { createAppStore } from '@/runtime/core/store';
import { createServerQueryClient } from '@/shared/server-data/query-client';

export function createTestInbox() {
  const store = createAppStore({
    settings: { serverUrl: 'http://server', username: '', password: '', directory: '' },
    chatPreferences: {} as never, controlPlaneUrl: '',
  });
  const query = createServerQueryClient();
  const controller = createPromptInboxCommands({
    cache: query, clock: Date.now,
    readOutbox: (scope) => store.getState().prompt[scope]?.outbox,
    writeOutbox: (scope, change) => store.getState().setPrompt(scope, (current) => ({ outbox: change(current.outbox ?? EMPTY_OUTBOX) })),
    subscribe: (scope, listener) => store.subscribe((current, previous) => {
      if (current.prompt[scope]?.outbox !== previous.prompt[scope]?.outbox) listener();
    }),
  });
  onTestFinished(() => { controller.dispose(); query.clear(); });
  function configure(initial: Parameters<typeof controller.configure>[0]) {
    let input = initial;
    controller.configure(input);
    return {
      update(patch: Partial<typeof initial>) {
        input = { ...input, ...patch };
        controller.configure(input);
      },
      get value() {
        const snapshot = query.getQueryData<PromptSnapshot>(promptInboxKey(input.identity, input.client)) ?? EMPTY_SNAPSHOT;
        return { ...controller.actions(input),
          pendingPromptsBySession: mergePromptOutbox(snapshot.prompts, store.getState().prompt[input.scope]?.outbox ?? EMPTY_OUTBOX),
          pendingNoticesBySession: snapshot.notices };
      },
    };
  }
  return { query, store, controller, configure };
}
