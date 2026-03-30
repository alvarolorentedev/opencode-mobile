import Constants from 'expo-constants';
import { Platform } from 'react-native';

let initialized = false;

let notificationsModulePromise: Promise<typeof import('expo-notifications') | null> | null = null;

function canUseNotifications() {
  return Constants.appOwnership !== 'expo';
}

async function getNotificationsModule() {
  if (!canUseNotifications()) {
    return null;
  }

  if (!notificationsModulePromise) {
    notificationsModulePromise = import('expo-notifications').then((mod) => {
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      return mod;
    });
  }

  return notificationsModulePromise;
}

export async function initializeNotifications() {
  if (initialized || !canUseNotifications()) {
    return;
  }

  const Notifications = await getNotificationsModule();
  if (!Notifications) {
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
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
    },
    trigger: null,
  });
}
