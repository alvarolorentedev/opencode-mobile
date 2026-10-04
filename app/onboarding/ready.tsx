import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, List, Text } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { useNotificationSetup } from '@/components/settings/use-notification-setup';
import { usePalette } from '@/providers/theme-provider';
import { getNormalizedServerUrl } from '@/lib/opencode/client';
import { getVoiceInputPermissionAsync, type VoiceInputPermission } from '@/lib/voice/permissions';
import { useCapabilities, useConnection, useOnboarding, usePreferences, useWorkspace } from '@/providers/opencode-contexts';

export default function OnboardingReadyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = usePalette();
  const { activeProject } = useWorkspace();
  const { availableModels } = useCapabilities();
  const { chatPreferences } = usePreferences();
  const { settings } = useConnection();
  const { onboardingActive, completeOnboarding, stopOnboardingReview } = useOnboarding();
  const notifications = useNotificationSetup();
  const [voice, setVoice] = useState<VoiceInputPermission>();
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    void getVoiceInputPermissionAsync().then(setVoice);
  }, []);

  const selectedModel = availableModels.find((model) => model.id === chatPreferences.modelId);
  const notificationsGranted = Boolean(notifications.status?.permissionGranted);
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
      step={6}
      totalSteps={6}
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
          title={t('onboarding:ready.workspace')}
          description={activeProject ? `${activeProject.label} · ${activeProject.path}` : t('onboarding:ready.workspaceMissing')}
          titleStyle={{ color: palette.muted, fontSize: 13 }}
          descriptionStyle={{ color: palette.text }}
          left={(props) => <List.Icon {...props} icon="folder-outline" color={palette.tint} />}
        />
        <List.Item
          title={t('onboarding:ready.model')}
          description={selectedModel ? `${selectedModel.providerLabel} · ${selectedModel.label}` : t('onboarding:ready.serverDefault')}
          titleStyle={{ color: palette.muted, fontSize: 13 }}
          descriptionStyle={{ color: palette.text }}
          left={(props) => <List.Icon {...props} icon="creation" color={palette.tint} />}
        />
        <List.Item
          title={t('onboarding:ready.notifications')}
          description={notificationsGranted ? t('common:labels.enabled') : t('common:labels.off')}
          titleStyle={{ color: palette.muted, fontSize: 13 }}
          descriptionStyle={{ color: palette.text }}
          left={(props) => <List.Icon {...props} icon="bell-outline" color={palette.tint} />}
        />
        <List.Item
          title={t('onboarding:ready.voice')}
          description={voice?.granted ? t('common:labels.enabled') : t('common:labels.off')}
          titleStyle={{ color: palette.muted, fontSize: 13 }}
          descriptionStyle={{ color: palette.text }}
          left={(props) => <List.Icon {...props} icon="microphone-outline" color={palette.tint} />}
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
