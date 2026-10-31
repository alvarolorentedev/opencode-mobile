import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { ListRow } from '@/shared/ui/list-row';
import { Icon } from '@/shared/ui/icon';
import { Button } from '@/shared/ui/button';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useOnboardingNavigation } from '@/features/onboarding/ui/use-onboarding-navigation';
import { OnboardingStep } from '@/features/onboarding/ui/onboarding-step';
import { usePalette } from '@/shared/ui/theme/use-palette';

export default function OnboardingWelcomeScreen() {
  const { t } = useTranslation();
  const navigation = useOnboardingNavigation('index');
  const palette = usePalette();

  return (
    <OnboardingStep
      step="index"
      title={t('onboarding:welcome.title')}
      subtitle={t('onboarding:welcome.subtitle')}
      testID="onboarding-welcome"
      footer={
        <Button testID="onboarding-welcome-start" onPress={navigation.next} variant="default"><Text>{t('onboarding:welcome.start')}</Text></Button>
      }>
      <View className={cn(stylesClasses.card, "bg-surface border-border")}>
        <MaterialCommunityIcons name="server-network" size={28} color={palette.tint} />
        <Text className={cn("text-foreground")} variant="description">{t('onboarding:welcome.body')}</Text>
      </View>
      <View><ListRow title={t('onboarding:welcome.points.server.title')} description={t('onboarding:welcome.points.server.description')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} left={(props) => <Icon {...props} color={palette.tint} name={"server"}></Icon>}></ListRow><ListRow title={t('onboarding:welcome.points.project.title')} description={t('onboarding:welcome.points.project.description')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} left={(props) => <Icon {...props} color={palette.tint} name={"folder-outline"}></Icon>}></ListRow><ListRow title={t('onboarding:welcome.points.optional.title')} description={t('onboarding:welcome.points.optional.description')} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} left={(props) => <Icon {...props} color={palette.tint} name={"microphone-outline"}></Icon>}></ListRow></View>
    </OnboardingStep>
  );
}

const stylesClasses = {
  "card": "items-center rounded-[16px] border gap-3 p-4.5"
} as const;
