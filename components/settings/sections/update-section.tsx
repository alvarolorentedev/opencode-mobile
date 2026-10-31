import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { FieldDescription } from '@/components/ui/text-field';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


import { UPDATE_CHECK_PERIOD_OPTIONS } from '@/components/settings/settings-utils';
import type { CatalogOption } from '@/components/ui/catalog-select';
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
