import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { SetupSummary } from '@/components/onboarding/setup-summary';
import { useOnboarding } from '@/providers/opencode-contexts';
import { usePalette } from '@/hooks/use-palette';

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
        <Button
          mode="contained"
          testID="onboarding-ready-start"
          loading={isFinishing}
          disabled={isFinishing}
          onPress={() => void finish()}>
          {onboardingActive ? t('onboarding:ready.done') : t('onboarding:ready.start')}
        </Button>
      }>
      <SetupSummary />
      <View style={styles.footerNote}>
        <MaterialCommunityIcons name="check-circle" size={18} color={palette.success} />
        <Text variant="bodySmall" style={{ color: palette.muted }}>{t('onboarding:ready.footnote')}</Text>
      </View>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  footerNote: { alignItems: 'center', flexDirection: 'row', gap: 8 },
});
