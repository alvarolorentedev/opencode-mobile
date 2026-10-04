import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, List, Text } from 'react-native-paper';

import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { usePalette } from '@/providers/theme-provider';
export default function OnboardingWelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = usePalette();

  return (
    <OnboardingStep
      step={1}
      totalSteps={6}
      title={t('onboarding:welcome.title')}
      subtitle={t('onboarding:welcome.subtitle')}
      testID="onboarding-welcome"
      footer={
        <Button
          mode="contained"
          testID="onboarding-welcome-start"
          onPress={() => router.push('/onboarding/connect')}>
          {t('onboarding:welcome.start')}
        </Button>
      }>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <MaterialCommunityIcons name="server-network" size={28} color={palette.tint} />
        <Text variant="bodyMedium" style={{ color: palette.text }}>{t('onboarding:welcome.body')}</Text>
      </View>
      <List.Section>
        <List.Item
          title={t('onboarding:welcome.points.server.title')}
          description={t('onboarding:welcome.points.server.description')}
          titleStyle={{ color: palette.text }}
          descriptionStyle={{ color: palette.muted }}
          left={(props) => <List.Icon {...props} icon="server" color={palette.tint} />}
        />
        <List.Item
          title={t('onboarding:welcome.points.workspace.title')}
          description={t('onboarding:welcome.points.workspace.description')}
          titleStyle={{ color: palette.text }}
          descriptionStyle={{ color: palette.muted }}
          left={(props) => <List.Icon {...props} icon="folder-outline" color={palette.tint} />}
        />
        <List.Item
          title={t('onboarding:welcome.points.optional.title')}
          description={t('onboarding:welcome.points.optional.description')}
          titleStyle={{ color: palette.text }}
          descriptionStyle={{ color: palette.muted }}
          left={(props) => <List.Icon {...props} icon="tune" color={palette.tint} />}
        />
      </List.Section>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', borderRadius: 16, borderWidth: 1, gap: 12, padding: 18 },
});
