import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { i18n } from '@/lib/i18n';
import { quickActionsSupported, setQuickActions, type QuickActionItem } from '@/lib/quick-actions';
import type { ActiveSessionItem } from '@/providers/opencode-provider-types';
import { getSessionQuickActions } from '@/providers/quick-action-items';

// Launcher shortcuts publish only in foreground; widget state is independently
// reconciled by use-widget-state so replies and blockers do not depend on the library.
const PUBLISH_DEBOUNCE_MS = 1500;

type Input = {
  // False until the connection state is known, so a cold start cannot clear
  // surfaces with an empty snapshot before hydration and connect resolve.
  ready: boolean;
  connected: boolean;
  connectionScope: string;
  language?: string;
  activeSessions: ActiveSessionItem[];
};

export function useNativeSurfaces({ ready, connected, connectionScope, language, activeSessions }: Input) {
  const sessionsRef = useRef(activeSessions);
  useLayoutEffect(() => { sessionsRef.current = activeSessions; });

  const surfaceable = quickActionsSupported;
  const sessionSignature = activeSessions
    .map((session) => `${session.sessionId}:${session.status.type}:${session.title ?? ''}`)
    .join('|');
  const signature = `${ready ? '1' : '0'}:${connected ? '1' : '0'}:${connectionScope}:${language ?? ''}:${sessionSignature}`;

  const publishQuickActions = useCallback(() => {
    if (!quickActionsSupported || AppState.currentState !== 'active') return;
    const items: QuickActionItem[] = connected
      ? [
        { id: 'new-chat', title: i18n.t('chat:library.newChat'), icon: 'compose', params: {} },
        ...getSessionQuickActions({
          activeSessions: sessionsRef.current,
          connectionScope,
          untitledLabel: i18n.t('chat:library.untitledChat'),
        }),
      ]
      : [];
    setQuickActions(items);
  }, [connected, connectionScope]);

  useEffect(() => {
    if (!surfaceable || !ready) return;
    const publish = () => {
      publishQuickActions();
    };
    const timer = setTimeout(publish, PUBLISH_DEBOUNCE_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') publish();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [publishQuickActions, ready, signature, surfaceable]);
}
