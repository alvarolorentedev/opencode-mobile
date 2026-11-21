import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { notificationResponseKey, parseNotificationRoute } from '@/shared/contracts/notification-route';

// Routes taps on locally scheduled completion/attention notifications through
// the existing session deep-link resolver, so the connection, project and
// session in the link are validated the same way as an external deep link.
export function useNotificationRoute() {
  const handled = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const key = notificationResponseKey(response.notification.request.identifier, response.notification.date);
      if (!key || handled.current === key) return;
      const route = parseNotificationRoute(response.notification.request.content.data);
      if (!route) return;
      handled.current = key;
      router.push({
        pathname: '/session/[id]',
        params: {
          id: route.sessionId,
          ...(route.projectPath ? { project: route.projectPath } : {}),
          ...(route.connectionScope ? { connectionScope: route.connectionScope } : {}),
        },
      });
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    return () => subscription.remove();
  }, []);
}
