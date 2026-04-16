import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

import type { ConversationPhase } from '@/providers/opencode-provider';

export function useConversationKeepAwake(phase: ConversationPhase, tag: string) {
  useEffect(() => {
    if (phase === 'off') {
      void deactivateKeepAwake(tag).catch(() => undefined);
      return;
    }

    void activateKeepAwakeAsync(tag).catch(() => undefined);

    return () => {
      void deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, [phase, tag]);
}
