import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

let initialized = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function initializeNotifications() {
  if (initialized) {
    return;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('task-finished', {
      name: 'Task finished',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180, 120, 180],
    });
  }

  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted && permissions.canAskAgain) {
    await Notifications.requestPermissionsAsync();
  }

  initialized = true;
}

export async function notifyTaskFinished(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
    },
    trigger: null,
  });
}
