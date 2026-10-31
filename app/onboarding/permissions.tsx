import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { FieldDescription } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';


import { useOnboardingNavigation } from '@/components/onboarding/use-onboarding-navigation';
import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { useNotificationSetup } from '@/components/settings/use-notification-setup';
import { getVoiceCapabilitiesAsync, type VoiceCapabilities } from '@/lib/voice/capabilities';
import { openVoiceSettingsAsync, requestVoiceInputPermissionAsync } from '@/lib/voice/permissions';
import { usePalette } from '@/hooks/use-palette';

export default function OnboardingPermissionsScreen() {
  const { t } = useTranslation();
  const navigation = useOnboardingNavigation('permissions');
  const palette = usePalette();
  const notifications = useNotificationSetup();
  const [voice, setVoice] = useState<VoiceCapabilities>();
  const [isEnablingVoice, setIsEnablingVoice] = useState(false);

  useEffect(() => {
    // Read-only: never prompts. Voice setup stays optional.
    void getVoiceCapabilitiesAsync().then(setVoice);
  }, []);

  async function enableVoice() {
    setIsEnablingVoice(true);
    try {
      await requestVoiceInputPermissionAsync();
      setVoice(await getVoiceCapabilitiesAsync());
    } finally {
      setIsEnablingVoice(false);
    }
  }

  const voicePermission = voice?.permission;
  // Permission may be granted while the recognizer itself is unavailable, so
  // treat either condition as "voice input is not usable on this device".
  const voiceUnsupported = Boolean(voice && (!voice.permission.available || !voice.recognitionAvailable));

  const notificationsGranted = Boolean(notifications.status?.permissionGranted);
  const notificationsUnsupported = notifications.status?.notificationsSupported === false;
  const notificationsBlocked = Boolean(notifications.status && !notificationsGranted && notifications.status.canAskAgain === false);
  const voiceBlocked = Boolean(voicePermission?.available && !voicePermission.granted && voicePermission.canAskAgain === false);

  return (
    <OnboardingStep
      step="permissions"
      title={t('onboarding:permissions.title')}
      subtitle={t('onboarding:permissions.subtitle')}
      testID="onboarding-permissions"
      footer={
        <>
          <Button testID="onboarding-permissions-skip" onPress={navigation.next} variant="ghost" className={cn("mr-auto")} ><Text>{t('onboarding:permissions.skip')}</Text></Button>
          <Button testID="onboarding-permissions-continue" onPress={navigation.next} variant="default"><Text>{t('onboarding:permissions.continue')}</Text></Button>
        </>
      }>
      <View className={cn(stylesClasses.card, "bg-surface border-border")}>
        <View className={cn(stylesClasses.cardHeader)}>
          <Text className={cn("text-foreground")} variant="description">{t('onboarding:permissions.notifications.title')}</Text>
          <Text style={{ color: notificationsGranted ? palette.success : palette.muted }} variant="label">{!notifications.status
              ? t('onboarding:permissions.checking')
              : notificationsGranted
                ? t('common:labels.enabled')
                : t('common:labels.off')}</Text>
        </View>
        <Text className={cn("text-muted-foreground")} variant="label">{t('onboarding:permissions.notifications.body')}</Text>
        {notificationsUnsupported ? (
          <FieldDescription  invalid={false}>{t('onboarding:permissions.notifications.unsupported')}</FieldDescription>
        ) : notificationsBlocked ? (
          <Button testID="onboarding-open-notification-settings" onPress={() => void notifications.openNotificationSettings()} variant="secondary"><Text>{t('common:actions.openSettings')}</Text></Button>
        ) : (
          <Button testID="onboarding-enable-notifications" disabled={notificationsGranted} onPress={() => void notifications.enable()} variant="secondary">{notifications.isRefreshing ? <Spinner size="small" /> : null}<Text>{t('onboarding:permissions.notifications.enable')}</Text></Button>
        )}
        {notifications.feedback ? <FieldDescription  invalid={false}>{notifications.feedback}</FieldDescription> : null}
        {Platform.OS === 'android' && notificationsGranted ? (
          <Button testID="onboarding-review-battery" onPress={() => void notifications.openBatterySettings()} variant="ghost"><Text>{t('onboarding:permissions.notifications.battery')}</Text></Button>
        ) : null}
      </View>

      <View className={cn(stylesClasses.card, "bg-surface border-border")}>
        <View className={cn(stylesClasses.cardHeader)}>
          <Text className={cn("text-foreground")} variant="description">{t('onboarding:permissions.voice.title')}</Text>
          <Text style={{ color: voicePermission?.granted ? palette.success : palette.muted }} variant="label">{!voice
              ? t('onboarding:permissions.checking')
              : voicePermission?.granted
                ? t('common:labels.enabled')
                : t('common:labels.off')}</Text>
        </View>
        <Text className={cn("text-muted-foreground")} variant="label">{t('onboarding:permissions.voice.body')}</Text>
        {voiceUnsupported ? (
          <FieldDescription  invalid={false}>{t('onboarding:permissions.voice.unsupported')}</FieldDescription>
        ) : voiceBlocked ? (
          <Button testID="onboarding-open-voice-settings" onPress={() => void openVoiceSettingsAsync()} variant="secondary"><Text>{t('common:actions.openSettings')}</Text></Button>
        ) : (
          <Button testID="onboarding-enable-voice" disabled={Boolean(voicePermission?.granted)} onPress={() => void enableVoice()} variant="secondary">{isEnablingVoice ? <Spinner size="small" /> : null}<Text>{t('onboarding:permissions.voice.enable')}</Text></Button>
        )}
        {voicePermission && voicePermission.available && !voicePermission.granted && voicePermission.canAskAgain ? (
          <FieldDescription  invalid={false}>{t('onboarding:permissions.voice.deniedHint')}</FieldDescription>
        ) : null}
      </View>
    </OnboardingStep>
  );
}



const stylesClasses = {
  "card": "rounded-[16px] border gap-2.5 p-4",
  "cardHeader": "items-center flex-row justify-between"
} as const;
