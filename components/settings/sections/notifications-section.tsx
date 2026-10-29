import { SettingButton as Button } from './setting-rows';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { List, Text } from 'react-native-paper';

import { SettingTarget } from '../settings-panel';
import type { NotificationDebugStatus } from '@/lib/notifications';
import type { Palette } from './setting-rows';

type NotificationsSectionProps = {
  isRefreshingNotificationStatus: boolean;
  notificationStatus?: NotificationDebugStatus;
  onEnableNotifications: () => void;
  onOpenAppSettings: () => void;
  onOpenBatterySaverSettings: () => void;
  onOpenBatterySettings: () => void;
  onOpenNotificationSettings: () => void;
  onRefreshStatus: () => void;
  palette: Palette;
};

export function NotificationsSection({
  isRefreshingNotificationStatus,
  notificationStatus,
  onEnableNotifications,
  onOpenAppSettings,
  onOpenBatterySaverSettings,
  onOpenBatterySettings,
  onOpenNotificationSettings,
  onRefreshStatus,
  palette,
}: NotificationsSectionProps) {
  const { t } = useTranslation();
  const notificationsEnabled = Boolean(notificationStatus?.permissionGranted);
  const notificationStatusKey = !notificationStatus ? 'checking' : notificationsEnabled ? 'enabled' : 'needsSetup';
  const notificationStatusTone = !notificationStatus ? palette.icon : notificationsEnabled ? palette.success : palette.warning;
  const backgroundStatusKey = !notificationStatus
    ? 'checking'
    : notificationStatus.backgroundMonitoringSupported
      ? notificationStatus.backgroundTaskRegistered
        ? 'ready'
        : 'limited'
      : 'limited';
  const notificationStatusLabel = t(`settings:notifications.status.${notificationStatusKey}`);
  const backgroundStatusLabel = t(`settings:notifications.background.${backgroundStatusKey}`);
  const notificationSummary = `${t(notificationsEnabled ? 'settings:notifications.summary.enabled' : 'settings:notifications.summary.off')}${backgroundStatusKey === 'checking' ? '' : ` • ${t('settings:notifications.summary.background', { status: backgroundStatusLabel.toLowerCase() })}`}`;

  return (
    <View style={styles.section}>
        <View style={[styles.connectionStatusCard, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <View style={styles.connectionStatusHeader}>
            <View style={styles.connectionStatusRow}>
              <View style={[styles.connectionStatusDot, { backgroundColor: notificationStatusTone }]} />
              <Text variant="labelLarge" style={{ color: palette.text }}>{notificationStatusLabel}</Text>
            </View>
            <Text variant="bodySmall" style={{ color: palette.muted }}>{notificationSummary}</Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <SettingTarget label={t('settings:notifications.enable')}><Button mode="contained" disabled={notificationsEnabled} onPress={onEnableNotifications}>
            {t('settings:notifications.enable')}
          </Button></SettingTarget>
          <SettingTarget label={t('settings:notifications.settings')}><Button mode="outlined" onPress={onOpenNotificationSettings}>
            {t('settings:notifications.settings')}
          </Button></SettingTarget>
        </View>
        <List.Section style={styles.infoListSection}>
          <SettingTarget label={t('settings:notifications.appSettings')}><List.Item
            title={t('settings:notifications.appSettings')}
            description={t('settings:notifications.appSettingsDescription')}
            titleStyle={{ color: palette.text }}
            descriptionStyle={{ color: palette.muted }}
            right={() => <Button onPress={onOpenAppSettings}>{t('common:actions.open')}</Button>}
          /></SettingTarget>
          {Platform.OS === 'android' ? (
            <SettingTarget label={t('settings:notifications.batteryOptimization')}><List.Item
              title={t('settings:notifications.batteryOptimization')}
              description={t('settings:notifications.batteryOptimizationDescription')}
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => <Button disabled={!notificationsEnabled} onPress={onOpenBatterySettings}>{t('common:actions.open')}</Button>}
            /></SettingTarget>
          ) : null}
          {Platform.OS === 'android' ? (
            <SettingTarget label={t('settings:notifications.batterySaver')}><List.Item
              title={t('settings:notifications.batterySaver')}
              description={t('settings:notifications.batterySaverDescription')}
              titleStyle={{ color: palette.text }}
              descriptionStyle={{ color: palette.muted }}
              right={() => <Button disabled={!notificationsEnabled} onPress={onOpenBatterySaverSettings}>{t('common:actions.open')}</Button>}
            /></SettingTarget>
          ) : null}
        </List.Section>
        <Button mode="text" loading={isRefreshingNotificationStatus} onPress={onRefreshStatus}>
          {t('settings:notifications.refreshStatus')}
        </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  connectionStatusCard: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  connectionStatusHeader: { gap: 6 },
  connectionStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  connectionStatusDot: { width: 10, height: 10, borderRadius: 999 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoListSection: { marginVertical: 0 },
});
