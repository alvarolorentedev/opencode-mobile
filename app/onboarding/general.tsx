import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from 'react-i18next';


import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { useOnboardingNavigation } from '@/components/onboarding/use-onboarding-navigation';
import { OnboardingGeneralSettings } from '@/components/onboarding/general-settings';

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
