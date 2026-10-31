import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';


import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { useOnboardingNavigation } from '@/components/onboarding/use-onboarding-navigation';
import { OnboardingVoiceSettings } from '@/components/onboarding/voice-settings';

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
