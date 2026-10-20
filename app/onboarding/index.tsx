import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, List, Text } from 'react-native-paper';

import { useOnboardingNavigation } from '@/components/onboarding/use-onboarding-navigation';
import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function OnboardingWelcomeScreen() {
  const { t } = useTranslation();
  const navigation = useOnboardingNavigation('index');
  const palette = Colors[useColorScheme() ?? 'light'];

  return (
    <OnboardingStep
      step="index"
      title={t('onboarding:welcome.title')}
      subtitle={t('onboarding:welcome.subtitle')}
      testID="onboarding-welcome"
      footer={
        <Button
          mode="contained"
          testID="onboarding-welcome-start"
          onPress={navigation.next}>
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
          title={t('onboarding:welcome.points.project.title')}
          description={t('onboarding:welcome.points.project.description')}
          titleStyle={{ color: palette.text }}
          descriptionStyle={{ color: palette.muted }}
          left={(props) => <List.Icon {...props} icon="folder-outline" color={palette.tint} />}
        />
        <List.Item
          title={t('onboarding:welcome.points.optional.title')}
          description={t('onboarding:welcome.points.optional.description')}
          titleStyle={{ color: palette.text }}
          descriptionStyle={{ color: palette.muted }}
          left={(props) => <List.Icon {...props} icon="microphone-outline" color={palette.tint} />}
        />
      </List.Section>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', borderRadius: 16, borderWidth: 1, gap: 12, padding: 18 },
});
