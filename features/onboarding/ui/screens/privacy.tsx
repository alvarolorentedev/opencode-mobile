import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';
import { SettingSwitchRow } from '@/shared/ui/settings/setting-rows';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { OnboardingStep } from '@/features/onboarding/ui/onboarding-step';
import { useOnboardingNavigation } from '@/features/onboarding/ui/use-onboarding-navigation';
import { remoteAvailable } from '@/shared/observability/config';
import { usePreferences } from '@/shared/preferences/context';
import { usePalette } from '@/shared/ui/theme/use-palette';

export default function OnboardingPrivacyScreen() {
  const { t } = useTranslation();
  const navigation = useOnboardingNavigation('privacy');
  const palette = usePalette();
  const { chatPreferences, updateChatPreferences } = usePreferences();
  const remote = remoteAvailable();

  return (
    <OnboardingStep step="privacy" title={t('onboarding:privacy.title')} subtitle={t('onboarding:privacy.subtitle')} testID="onboarding-privacy" footer={
      <>
        <Button testID="onboarding-privacy-skip" onPress={navigation.next} variant="ghost" className={cn("mr-auto")}><Text>{t('onboarding:permissions.skip')}</Text></Button>
        <Button testID="onboarding-privacy-continue" onPress={navigation.next} variant="default"><Text>{t('onboarding:permissions.continue')}</Text></Button>
      </>
    }>
      <View className={cn("gap-1")}>
        <SettingSwitchRow
          title={t('settings:diagnostics.localTitle')}
          description={t('settings:diagnostics.localDescription')}
          value={chatPreferences.diagnosticsEnabled !== false}
          palette={palette}
          onValueChange={(diagnosticsEnabled) => updateChatPreferences({ diagnosticsEnabled })}
        />
        {remote ? <SettingSwitchRow
          title={t('settings:diagnostics.remoteMasterTitle')}
          description={t('settings:diagnostics.remoteMasterDescription')}
          value={chatPreferences.remoteTelemetryEnabled !== false}
          palette={palette}
          onValueChange={(remoteTelemetryEnabled) => updateChatPreferences({
            remoteTelemetryEnabled,
            ...(remoteTelemetryEnabled ? {} : { remoteCrashReports: false, remotePerformance: false }),
          })}
        /> : null}
      </View>
    </OnboardingStep>
  );
}
