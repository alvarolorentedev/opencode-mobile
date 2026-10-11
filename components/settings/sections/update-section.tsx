import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';

import { UPDATE_CHECK_PERIOD_OPTIONS } from '@/components/settings/settings-utils';
import type { NativeSelectOption } from '@/components/ui/native-select';
import type { UpdateCheckPeriod } from '@/providers/app-update-policy';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';

export function UpdateSection({ enabled, checkPeriod, onEnabledChange, onCheckPeriodChange, palette }: {
  enabled: boolean;
  checkPeriod: UpdateCheckPeriod;
  onEnabledChange: (enabled: boolean) => void;
  onCheckPeriodChange: (period: UpdateCheckPeriod) => void;
  palette: Palette;
}) {
  const { t } = useTranslation();
  const options: NativeSelectOption<UpdateCheckPeriod>[] = UPDATE_CHECK_PERIOD_OPTIONS.map((option) => ({
    description: t(`settings:autoUpdate.checkPeriod.${option.value}.description`),
    label: t(`settings:autoUpdate.checkPeriod.${option.value}.label`),
    value: option.value,
  }));
  return (
    <View testID="settings-update-section" style={styles.section}>
      <Text accessibilityRole="header" variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:autoUpdate.title')}</Text>
      <SettingSwitchRow
        description={t('settings:autoUpdate.enable.description')}
        onValueChange={onEnabledChange}
        palette={palette}
        title={t('settings:autoUpdate.enable.title')}
        value={enabled}
      />
      <SettingSelectField
        disabled={!enabled}
        label={t('settings:autoUpdate.checkPeriod.label')}
        onValueChange={onCheckPeriodChange}
        options={options}
        palette={palette}
        selectedValue={checkPeriod}
        valueLabel={t(`settings:autoUpdate.checkPeriod.${checkPeriod}.label`)}
      />
      <HelperText type="info">{t(`settings:autoUpdate.checkPeriod.${checkPeriod}.description`)}</HelperText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
  title: { fontWeight: '600' },
});
