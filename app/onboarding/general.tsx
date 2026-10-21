import { useTranslation } from 'react-i18next';
import { Button } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { useOnboardingNavigation } from '@/components/onboarding/use-onboarding-navigation';
import { OnboardingGeneralSettings } from '@/components/onboarding/general-settings';

export default function OnboardingGeneralScreen() {
  const { t } = useTranslation();
  const navigation = useOnboardingNavigation('general');
  return (
    <OnboardingStep step="general" title={t('onboarding:general.title')} subtitle={t('onboarding:general.subtitle')} testID="onboarding-general" footer={
      <>
        <Button style={{ marginRight: 'auto' }} testID="onboarding-general-skip" onPress={navigation.next}>{t('onboarding:permissions.skip')}</Button>
        <Button mode="contained" testID="onboarding-general-continue" onPress={navigation.next}>{t('onboarding:permissions.continue')}</Button>
      </>
    }>
      <OnboardingGeneralSettings />
    </OnboardingStep>
  );
}
