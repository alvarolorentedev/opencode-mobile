import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';
import { useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { OnboardingStep } from '@/features/onboarding/ui/onboarding-step';
import { useOnboardingNavigation } from '@/features/onboarding/ui/use-onboarding-navigation';
import { OnboardingVoiceSettings } from '@/features/onboarding/ui/voice-settings';

export default function OnboardingVoiceScreen() {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const navigation = useOnboardingNavigation('voice');
  return (
    <OnboardingStep step="voice" title={t('onboarding:voice.title')} subtitle={t('onboarding:voice.subtitle')} testID="onboarding-voice" footer={
      <>
        <Button testID="onboarding-voice-skip" onPress={navigation.next} variant={"ghost"} className={cn("mr-auto")} style={[undefined, undefined]}><Text>{t('onboarding:permissions.skip')}</Text></Button>
        <Button testID="onboarding-voice-continue" onPress={navigation.next} variant={"default"}><Text>{t('onboarding:permissions.continue')}</Text></Button>
      </>
    }>
      {/* Stack routes stay mounted; release playback and enrollment on blur. */}
      {focused ? <OnboardingVoiceSettings /> : null}
    </OnboardingStep>
  );
}
