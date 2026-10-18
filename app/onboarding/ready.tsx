import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, List, Text } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getNormalizedServerUrl } from '@/lib/opencode/client';
import { useConnection, useOnboarding, useProjects } from '@/providers/opencode-contexts';

export default function OnboardingReadyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = Colors[useColorScheme() ?? 'light'];
  const { activeProject } = useProjects();
  const { settings } = useConnection();
  const { onboardingActive, completeOnboarding, stopOnboardingReview } = useOnboarding();
  const [isFinishing, setIsFinishing] = useState(false);
  const serverLabel = getNormalizedServerUrl(settings.serverUrl);
  const usernameSuffix = settings.username.trim() ? ` (${settings.username.trim()})` : '';

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
      step={5}
      totalSteps={5}
      title={t('onboarding:ready.title')}
      subtitle={t('onboarding:ready.subtitle')}
      testID="onboarding-ready"
      onBack={() => router.back()}
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
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <List.Item
          title={t('onboarding:ready.server')}
          description={`${serverLabel}${usernameSuffix}`}
          titleStyle={{ color: palette.muted, fontSize: 13 }}
          descriptionStyle={{ color: palette.text }}
          left={(props) => <List.Icon {...props} icon="server-network" color={palette.tint} />}
        />
        <List.Item
          title={t('onboarding:ready.project')}
          description={activeProject ? `${activeProject.label} · ${activeProject.path}` : t('onboarding:ready.projectMissing')}
          titleStyle={{ color: palette.muted, fontSize: 13 }}
          descriptionStyle={{ color: palette.text }}
          left={(props) => <List.Icon {...props} icon="folder-outline" color={palette.tint} />}
        />
      </View>
      <View style={styles.footerNote}>
        <MaterialCommunityIcons name="check-circle" size={18} color={palette.success} />
        <Text variant="bodySmall" style={{ color: palette.muted }}>{t('onboarding:ready.footnote')}</Text>
      </View>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  footerNote: { alignItems: 'center', flexDirection: 'row', gap: 8 },
});
