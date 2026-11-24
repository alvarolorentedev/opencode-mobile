import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useProjectScope } from '@/runtime/core';
import { viewSession } from '@/shared/protocol/services/session-service';

import { useCurrentSession } from '../context';
import { sessionUnreadAt } from '../model/session-utils';

// V2 only: a focused, foreground chat reports its latest completed run as viewed.
export function useSessionViewed(focused: boolean) {
  const { client } = useProjectScope();
  const { currentSessionId, activeSession } = useCurrentSession();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const idle = sessionUnreadAt(activeSession);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!focused || !appActive || !currentSessionId || idle === undefined) return;
    void viewSession(client, currentSessionId, idle).catch(() => undefined);
  }, [appActive, client, currentSessionId, focused, idle]);
}
