import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { FieldDescription } from '@/shared/ui/text-field';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { UPDATE_CHECK_PERIOD_OPTIONS } from '@/features/updates/model/settings-options';
import type { CatalogOption } from '@/shared/ui/catalog-select';
import type { UpdateCheckPeriod } from '@/features/updates/model/app-update-policy';
import { SettingSelectField, SettingSwitchRow, type Palette } from '@/shared/ui/settings/setting-rows';

export function UpdateSection({ enabled, checkPeriod, onEnabledChange, onCheckPeriodChange, palette }: {
  enabled: boolean;
  checkPeriod: UpdateCheckPeriod;
  onEnabledChange: (enabled: boolean) => void;
  onCheckPeriodChange: (period: UpdateCheckPeriod) => void;
  palette: Palette;
}) {
  const { t } = useTranslation();
  const options: CatalogOption<UpdateCheckPeriod>[] = UPDATE_CHECK_PERIOD_OPTIONS.map((option) => ({
    description: t(`settings:autoUpdate.checkPeriod.${option.value}.description`),
    label: t(`settings:autoUpdate.checkPeriod.${option.value}.label`),
    value: option.value,
  }));
  return (
    <View testID="settings-update-section" className={cn(stylesClasses.section)}>
      <Text accessibilityRole="header" className={cn(stylesClasses.title, "text-foreground")} variant="heading">{t('settings:autoUpdate.title')}</Text>
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
      <FieldDescription  invalid={false}>{t(`settings:autoUpdate.checkPeriod.${checkPeriod}.description`)}</FieldDescription>
    </View>
  );
}

const stylesClasses = {
  "section": "gap-3.5 pb-2",
  "title": "font-semibold"
} as const;
