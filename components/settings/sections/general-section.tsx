import { SettingButton as Button } from './setting-rows';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { HelperText } from 'react-native-paper';

import { SettingTarget } from '../settings-panel';
import type { Palette } from './setting-rows';

export function GeneralSection({ palette, onResetOnboarding }: {
  palette: Palette;
  onResetOnboarding: () => void;
}) {
  const { t } = useTranslation();
  return <View testID="settings-general-section">
    <SettingTarget label={t('settings:general.resetOnboarding')}>
      <Button mode="outlined" icon="restart" textColor={palette.text} onPress={onResetOnboarding}>{t('settings:general.resetOnboarding')}</Button>
    </SettingTarget>
    <HelperText type="info">{t('onboarding:settingsAssistant.summary')}</HelperText>
  </View>;
}
