import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText } from 'react-native-paper';

import type { NativeSelectOption } from '@/components/ui/native-select';
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
  const languageOptions: NativeSelectOption<string>[] = [
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
      {showDescription ? <HelperText type="info">{t('settings:language.description')}</HelperText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 14, paddingBottom: 8 },
});
