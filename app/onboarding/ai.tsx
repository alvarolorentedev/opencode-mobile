import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from 'react-i18next';


import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { useOnboardingNavigation } from '@/components/onboarding/use-onboarding-navigation';
import { AiSettingsPanel } from '@/components/settings/ai-settings-panel';

export default function OnboardingAiScreen() {
  const { t } = useTranslation();
  const navigation = useOnboardingNavigation('ai');
  return (
    <OnboardingStep step="ai" title={t('settings:screen.categories.ai')} testID="onboarding-ai" footer={
      <>
        <Button testID="onboarding-ai-skip" onPress={navigation.next} variant={"ghost"} className={cn("mr-auto")} style={[undefined, undefined]}><Text>{t('onboarding:permissions.skip')}</Text></Button>
        <Button testID="onboarding-ai-continue" onPress={navigation.next} variant={"default"}><Text>{t('onboarding:permissions.continue')}</Text></Button>
      </>
    }>
      <AiSettingsPanel />
    </OnboardingStep>
  );
}
