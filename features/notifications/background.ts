import { AppRegistry } from 'react-native';

import { activityNotifications } from '@/shared/platform/activity-notifications';

if (activityNotifications) {
  const native = activityNotifications;
  AppRegistry.registerHeadlessTask('opencode-activity-keepalive', () => async () => {
    // Headless task keeps RN timers alive; the provider still owns SSE and polling.
    await native.waitUntilStopped();
  });
}
