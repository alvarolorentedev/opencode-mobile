import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { FieldDescription } from '@/components/ui/text-field';

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


import { SettingTarget } from '../settings-panel';
import { Palette } from './setting-rows';

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
