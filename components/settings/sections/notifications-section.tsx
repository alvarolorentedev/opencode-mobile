import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';

import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';


import { SettingTarget } from '../settings-panel';
import type { NotificationDebugStatus } from '@/lib/notifications';
import { Palette } from './setting-rows';

type NotificationsSectionProps = {
  notificationStatus?: NotificationDebugStatus;
  onEnableNotifications: () => void;
  onOpenAppSettings: () => void;
  onOpenBatterySaverSettings: () => void;
  onOpenBatterySettings: () => void;
  onOpenNotificationSettings: () => void;
  palette: Palette;
};

export function NotificationsSection({
  notificationStatus,
  onEnableNotifications,
  onOpenAppSettings,
  onOpenBatterySaverSettings,
  onOpenBatterySettings,
  onOpenNotificationSettings,
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
    <View className={cn(stylesClasses.section)}>
        <View className={cn(stylesClasses.connectionStatusCard, "bg-background border-border")}>
          <View className={cn(stylesClasses.connectionStatusHeader)}>
            <View className={cn(stylesClasses.connectionStatusRow)}>
              <View className={cn(stylesClasses.connectionStatusDot)} style={[{ backgroundColor: notificationStatusTone }]} />
              <Text className={cn("text-foreground")} variant="description">{notificationStatusLabel}</Text>
            </View>
            <Text className={cn("text-muted-foreground")} variant="label">{notificationSummary}</Text>
          </View>
        </View>
        <View className={cn(stylesClasses.actionRow)}>
          <SettingTarget label={t('settings:notifications.enable')}><Button disabled={notificationsEnabled} onPress={onEnableNotifications} variant="default"><Text>{t('settings:notifications.enable')}</Text></Button></SettingTarget>
          <SettingTarget label={t('settings:notifications.settings')}><Button onPress={onOpenNotificationSettings} variant="outline"><Text>{t('settings:notifications.settings')}</Text></Button></SettingTarget>
        </View>
        <View className={cn(stylesClasses.infoListSection)}><SettingTarget label={t('settings:notifications.appSettings')}><ListRow title={t('settings:notifications.appSettings')} description={t('settings:notifications.appSettingsDescription')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} right={() => <Button onPress={onOpenAppSettings} variant="ghost"><Text>{t('common:actions.open')}</Text></Button>}></ListRow></SettingTarget>{Platform.OS === 'android' ? (
            <SettingTarget label={t('settings:notifications.batteryOptimization')}><ListRow title={t('settings:notifications.batteryOptimization')} description={t('settings:notifications.batteryOptimizationDescription')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} right={() => <Button disabled={!notificationsEnabled} onPress={onOpenBatterySettings} variant="ghost"><Text>{t('common:actions.open')}</Text></Button>}></ListRow></SettingTarget>
          ) : null}{Platform.OS === 'android' ? (
            <SettingTarget label={t('settings:notifications.batterySaver')}><ListRow title={t('settings:notifications.batterySaver')} description={t('settings:notifications.batterySaverDescription')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} right={() => <Button disabled={!notificationsEnabled} onPress={onOpenBatterySaverSettings} variant="ghost"><Text>{t('common:actions.open')}</Text></Button>}></ListRow></SettingTarget>
          ) : null}</View>
    </View>
  );
}



const stylesClasses = {
  "section": "gap-3.5 pb-2",
  "connectionStatusCard": "rounded-[14px] border px-3.5 py-3",
  "connectionStatusHeader": "gap-1.5",
  "connectionStatusRow": "flex-row items-center gap-2.5",
  "connectionStatusDot": "w-2.5 h-2.5 rounded-full",
  "actionRow": "flex-row flex-wrap gap-2.5",
  "infoListSection": "my-0"
} as const;
