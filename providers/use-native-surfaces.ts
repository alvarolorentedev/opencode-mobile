import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { i18n } from '@/lib/i18n';
import { quickActionsSupported, setQuickActions, type QuickActionItem } from '@/lib/quick-actions';
import { homeWidgetSupported, updateHomeWidget } from '@/lib/widgets';
import type { ActiveSessionItem } from '@/providers/opencode-provider-types';
import { getSessionQuickActions } from '@/providers/quick-action-items';
import { buildWidgetSnapshot } from '@/providers/widget-snapshot';
import { saveWidgetSnapshot } from '@/providers/widget-snapshot-storage';

// Publishes the two native entry-point surfaces from confirmed provider state:
// launcher quick actions and the Android home widget. Data is read from the
// provider's existing cross-workspace active-session selection; nothing new is
// fetched, and the widget snapshot carries no credentials.
//
// Android throttles dynamic shortcut updates while the app is in the
// background, so shortcut publishing waits for the foreground. Widget repaints
// are cheap local RemoteViews updates and may run while the foreground service
// keeps JS alive.
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

  const surfaceable = quickActionsSupported || homeWidgetSupported;
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

  const publishWidget = useCallback(() => {
    if (!homeWidgetSupported || !connected) return;
    const snapshot = buildWidgetSnapshot({
      activeSessions: sessionsRef.current,
      connectionScope,
      untitledLabel: i18n.t('chat:library.untitledChat'),
      updatedAt: Date.now(),
    });
    void saveWidgetSnapshot(snapshot);
    void updateHomeWidget(snapshot);
  }, [connected, connectionScope]);

  useEffect(() => {
    if (!surfaceable || !ready) return;
    const publish = () => {
      publishQuickActions();
      publishWidget();
    };
    const timer = setTimeout(publish, PUBLISH_DEBOUNCE_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') publish();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [publishQuickActions, publishWidget, ready, signature, surfaceable]);
}
