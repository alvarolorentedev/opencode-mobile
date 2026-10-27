import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { HelperText } from 'react-native-paper';

import { type NativeSelectOption } from '@/components/ui/native-select';
import { RESPONSE_SCOPE_OPTIONS } from '@/components/settings/settings-utils';
import type { ResponseScope } from '@/providers/opencode-provider';
import { SettingSelectField, SettingSwitchRow, type Palette } from './setting-rows';

type ResponsesSectionProps = {
  chatPreferences: {
    includeNextActions: boolean;
    responseScope: ResponseScope;
  };
  palette: Palette;
  selectedResponseScope: { value: ResponseScope };
  updateChatPreferences: (patch: { includeNextActions?: boolean; responseScope?: ResponseScope }) => void;
};

export function ResponsesSection({
  chatPreferences,
  palette,
  selectedResponseScope,
  updateChatPreferences,
}: ResponsesSectionProps) {
  const { t } = useTranslation();
  const responseScopeOptions: NativeSelectOption<ResponseScope>[] = RESPONSE_SCOPE_OPTIONS.map((option) => ({
    description: t(`settings:voice.responseScope.${option.value}.description`),
    label: t(`settings:voice.responseScope.${option.value}.label`),
    value: option.value,
  }));

  return (
    <View style={styles.section}>
      <SettingSelectField
        label={t('settings:voice.responseScope.label')}
        onValueChange={(value) => updateChatPreferences({ responseScope: value })}
        options={responseScopeOptions}
        palette={palette}
        selectedValue={selectedResponseScope.value}
        valueLabel={t(`settings:voice.responseScope.${selectedResponseScope.value}.label`)}
      />
      <HelperText type="info">{t(`settings:voice.responseScope.${selectedResponseScope.value}.description`)}</HelperText>
      <SettingSwitchRow
        description={t('settings:voice.nextActions.description')}
        onValueChange={(value) => updateChatPreferences({ includeNextActions: value })}
        palette={palette}
        title={t('settings:voice.nextActions.title')}
        value={chatPreferences.includeNextActions}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, paddingBottom: 8 },
});
