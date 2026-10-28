import { useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from 'react-native-paper';

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
        <Button style={{ marginRight: 'auto' }} testID="onboarding-voice-skip" onPress={navigation.next}>{t('onboarding:permissions.skip')}</Button>
        <Button mode="contained" testID="onboarding-voice-continue" onPress={navigation.next}>{t('onboarding:permissions.continue')}</Button>
      </>
    }>
      {/* Stack routes stay mounted; release playback and enrollment on blur. */}
      {focused ? <OnboardingVoiceSettings /> : null}
    </OnboardingStep>
  );
}
