import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';
import { useTranslation } from 'react-i18next';

import { OnboardingStep } from '@/features/onboarding/ui/onboarding-step';
import { useOnboardingNavigation } from '@/features/onboarding/ui/use-onboarding-navigation';
import { OnboardingGeneralSettings } from '@/features/onboarding/ui/general-settings';

export default function OnboardingGeneralScreen() {
  const { t } = useTranslation();
  const navigation = useOnboardingNavigation('general');
  return (
    <OnboardingStep step="general" title={t('onboarding:general.title')} subtitle={t('onboarding:general.subtitle')} testID="onboarding-general" footer={
      <>
        <Button testID="onboarding-general-skip" onPress={navigation.next} variant={"ghost"} className={cn("mr-auto")} style={[undefined, undefined]}><Text>{t('onboarding:permissions.skip')}</Text></Button>
        <Button testID="onboarding-general-continue" onPress={navigation.next} variant={"default"}><Text>{t('onboarding:permissions.continue')}</Text></Button>
      </>
    }>
      <OnboardingGeneralSettings />
    </OnboardingStep>
  );
}
