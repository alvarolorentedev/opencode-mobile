import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';

import { ensureNotificationPermissionsAsync, getNotificationDebugStatusAsync, type NotificationDebugStatus } from '@/features/notifications/services/notifications';

/**
 * Notification permission + status + platform-settings controller shared by the
 * Settings notifications section and the onboarding permissions step.
 *
 * Permission is only requested from `enable()`; nothing in here prompts on
 * mount. `refreshStatus()` is read-only.
 */
export function useNotificationSetup() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<NotificationDebugStatus>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const applicationId = useMemo(
    () => Constants.expoConfig?.android?.package || Constants.expoConfig?.ios?.bundleIdentifier,
    [],
  );

  const refreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setStatus(await getNotificationDebugStatusAsync());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const enable = useCallback(async () => {
    const permissions = await ensureNotificationPermissionsAsync();
    await refreshStatus();
    setFeedback(
      permissions?.granted
        ? t('settings:notifications.enabledFeedback')
        : t('settings:notifications.disabledFeedback'),
    );
    return Boolean(permissions?.granted);
  }, [refreshStatus, t]);

  const openAppSettings = useCallback(async () => {
    await Linking.openSettings();
  }, []);

  const openNotificationSettings = useCallback(async () => {
    if (Platform.OS !== 'android') {
      await Linking.openSettings();
      return;
    }

    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
        extra: applicationId ? { 'android.provider.extra.APP_PACKAGE': applicationId } : undefined,
      });
    } catch {
      await Linking.openSettings();
    }
  }, [applicationId]);

  const openBatterySettings = useCallback(async () => {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
    } catch {
      await Linking.openSettings();
    }
  }, []);

  const openBatterySaverSettings = useCallback(async () => {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.BATTERY_SAVER_SETTINGS);
    } catch {
      await Linking.openSettings();
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate notification status once on mount.
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    // Permission and background-task state can change in system settings while
    // the app is backgrounded. Re-read it when the app becomes active instead
    // of exposing a manual refresh action.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshStatus();
    });
    return () => subscription.remove();
  }, [refreshStatus]);

  return {
    status,
    isRefreshing,
    feedback,
    clearFeedback: useCallback(() => setFeedback(undefined), []),
    refreshStatus,
    enable,
    openAppSettings,
    openNotificationSettings,
    openBatterySettings,
    openBatterySaverSettings,
  };
}
