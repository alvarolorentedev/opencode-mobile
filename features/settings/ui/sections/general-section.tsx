import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { FieldDescription } from '@/shared/ui/text-field';

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { SettingTarget } from '@/shared/ui/settings/settings-panel';
import { Palette } from '@/shared/ui/settings/setting-rows';

export function GeneralSection({ palette, onResetOnboarding }: {
  palette: Palette;
  onResetOnboarding: () => void;
}) {
  const { t } = useTranslation();
  return <View testID="settings-general-section">
    <SettingTarget label={t('settings:general.resetOnboarding')}>
      <Button onPress={onResetOnboarding} variant={"outline"}><Icon name={"restart"} size={20} color={palette.text} /><Text className={cn("text-foreground")} style={[undefined]}>{t('settings:general.resetOnboarding')}</Text></Button>
    </SettingTarget>
    <FieldDescription  invalid={false}>{t('onboarding:settingsAssistant.summary')}</FieldDescription>
  </View>;
}
