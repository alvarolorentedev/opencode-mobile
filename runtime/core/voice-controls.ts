import type { ConversationConfirmationState } from '@/features/voice/index';

type Controls = {
  toggle: () => Promise<void>;
  pause: () => Promise<void>;
  clearFeedback: () => void;
  confirmation: ConversationConfirmationState['actions'];
};

export function createVoiceControls() {
  type Owner = { connectionId: string; scopeKey: string; controls: Controls; stopping?: Promise<void> };
  let active: Owner | undefined;
  let releasing = Promise.resolve();

  function stop(owner: Owner) {
    owner.stopping ??= owner.controls.pause().finally(() => { owner.stopping = undefined; });
    return owner.stopping;
  }
  return {
    attach(connectionId: string, scopeKey: string, controls: Controls) {
      const owner: Owner = { connectionId, scopeKey, controls };
      active = owner;
      return () => {
        if (active !== owner) return;
        active = undefined;
        const stopped = stop(owner).catch(() => undefined);
        releasing = Promise.all([releasing, stopped]).then(() => undefined);
      };
    },
    async toggle(scopeKey: string) {
      const owner = active;
      await releasing;
      if (owner === active && owner?.scopeKey === scopeKey) await owner.controls.toggle();
    },
    async pause(connectionId?: string) {
      const owner = active;
      if (owner && (!connectionId || owner.connectionId === connectionId)) await stop(owner);
      await releasing;
    },
    read(scopeKey: string) {
      return active?.scopeKey === scopeKey ? active.controls : undefined;
    },
  };
}
