import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { OnboardingStep } from '@/features/onboarding/ui/onboarding-step';
import { SetupSummary } from '@/features/onboarding/ui/setup-summary';
import { useOnboarding } from '@/features/onboarding/context';
import { usePalette } from '@/shared/ui/theme/use-palette';

export default function OnboardingReadyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = usePalette();
  const { onboardingActive, completeOnboarding, stopOnboardingReview } = useOnboarding();
  const [isFinishing, setIsFinishing] = useState(false);

  async function finish() {
    setIsFinishing(true);
    try {
      if (onboardingActive) {
        // Review mode: configuration was already persisted by the steps that
        // changed it. Just close the assistant and return to Settings.
        stopOnboardingReview();
        router.replace('/(tabs)/settings');
        return;
      }

      await completeOnboarding();
      // Let the guard commit before navigating so `(tabs)` is registered.
      requestAnimationFrame(() => router.replace('/(tabs)'));
    } finally {
      setIsFinishing(false);
    }
  }

  return (
    <OnboardingStep
      step="ready"
      title={t('onboarding:ready.title')}
      subtitle={t('onboarding:ready.subtitle')}
      testID="onboarding-ready"
      footer={
        <Button testID="onboarding-ready-start" disabled={isFinishing} onPress={() => void finish()} variant="default">{isFinishing ? <Spinner size="small" /> : null}<Text>{onboardingActive ? t('onboarding:ready.done') : t('onboarding:ready.start')}</Text></Button>
      }>
      <SetupSummary />
      <View className={cn(stylesClasses.footerNote)}>
        <MaterialCommunityIcons name="check-circle" size={18} color={palette.success} />
        <Text className={cn("text-muted-foreground")} variant="label">{t('onboarding:ready.footnote')}</Text>
      </View>
    </OnboardingStep>
  );
}

const stylesClasses = {
  "footerNote": "items-center flex-row gap-2"
} as const;
