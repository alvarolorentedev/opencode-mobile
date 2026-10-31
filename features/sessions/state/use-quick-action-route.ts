import { router } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { readInitialQuickAction, subscribeQuickActions, type QuickAction } from '@/shared/platform/quick-actions';
import { useCurrentSession } from '@/features/sessions/context';

// Routes a launcher/home-screen quick action into the app. Session actions reuse
// the existing session deep-link resolver, so the connection, project, and
// session are validated exactly like an external link or a notification tap.
// New chat creates through the provider and lands on the Chat tab. The initial
// cold-start action is consumed once, after hydration, to avoid navigating
// before the router mounts.
export function useQuickActionRoute(isHydrated: boolean) {
  const { createSession } = useCurrentSession();
  const createSessionRef = useRef(createSession);
  useLayoutEffect(() => { createSessionRef.current = createSession; });
  const initialHandled = useRef(false);

  const open = useCallback((action: QuickAction | undefined) => {
    if (!action?.id) return;
    const params = action.params ?? {};
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
    if (!sessionId) {
      if (action.id === 'new-chat') {
        void createSessionRef.current().catch(() => undefined);
      }
      router.navigate('/(tabs)');
      return;
    }
    const projectPath = typeof params.projectPath === 'string' ? params.projectPath.trim() : '';
    const connectionScope = typeof params.connectionScope === 'string' ? params.connectionScope.trim() : '';
    router.push({
      pathname: '/session/[id]',
      params: {
        id: sessionId,
        ...(projectPath ? { project: projectPath } : {}),
        ...(connectionScope ? { connectionScope } : {}),
      },
    });
  }, []);

  useEffect(() => subscribeQuickActions(open), [open]);

  useEffect(() => {
    if (!isHydrated || initialHandled.current) return;
    initialHandled.current = true;
    open(readInitialQuickAction());
  }, [isHydrated, open]);
}
