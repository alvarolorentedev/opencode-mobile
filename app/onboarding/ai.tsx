import { useTranslation } from 'react-i18next';
import { Button } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { useOnboardingNavigation } from '@/components/onboarding/use-onboarding-navigation';
import { AiSettingsPanel } from '@/components/settings/ai-settings-panel';

export default function OnboardingAiScreen() {
  const { t } = useTranslation();
  const navigation = useOnboardingNavigation('ai');
  return (
    <OnboardingStep step="ai" title={t('settings:screen.categories.ai')} testID="onboarding-ai" footer={
      <>
        <Button style={{ marginRight: 'auto' }} testID="onboarding-ai-skip" onPress={navigation.next}>{t('onboarding:permissions.skip')}</Button>
        <Button mode="contained" testID="onboarding-ai-continue" onPress={navigation.next}>{t('onboarding:permissions.continue')}</Button>
      </>
    }>
      <AiSettingsPanel />
    </OnboardingStep>
  );
}
