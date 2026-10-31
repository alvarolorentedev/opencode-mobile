import { FieldDescription } from '@/components/ui/text-field';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';


import type { CatalogOption } from '@/components/ui/catalog-select';
import { LANGUAGE_OPTIONS } from '@/components/settings/settings-utils';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { SettingSelectField, type Palette } from './setting-rows';

export function LanguageSection({
  chatPreferences,
  palette,
  updateChatPreferences,
  showDescription = true,
}: {
  chatPreferences: ChatPreferences;
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  showDescription?: boolean;
}) {
  const { t } = useTranslation();
  const languageOptions: CatalogOption<string>[] = [
    { label: t('common:labels.systemDefault'), value: 'system' },
    ...LANGUAGE_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
  ];
  const selectedValue = chatPreferences.language ?? 'system';
  const valueLabel = languageOptions.find((option) => option.value === selectedValue)?.label
    || t('common:labels.systemDefault');

  return (
    <View style={showDescription ? styles.section : undefined}>
      <SettingSelectField
        testID="settings-language"
        label={t('settings:language.title')}
        onValueChange={(value) => updateChatPreferences({ language: value === 'system' ? undefined : value })}
        options={languageOptions}
        palette={palette}
        selectedValue={selectedValue}
        valueLabel={valueLabel}
      />
      {showDescription ? <FieldDescription  invalid={false}>{t('settings:language.description')}</FieldDescription> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 }
});
