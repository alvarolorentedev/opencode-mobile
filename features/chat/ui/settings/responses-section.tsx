import { cn } from '@/shared/ui/cn';
import { FieldDescription } from '@/shared/ui/text-field';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { CatalogOption } from '@/shared/ui/catalog-select';
import { RESPONSE_SCOPE_OPTIONS } from '@/features/chat/model/settings-options';
import type { ResponseScope } from '@/shared/preferences/opencode-preferences';
import { SettingSelectField, SettingSwitchRow, type Palette } from '@/shared/ui/settings/setting-rows';

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
  const responseScopeOptions: CatalogOption<ResponseScope>[] = RESPONSE_SCOPE_OPTIONS.map((option) => ({
    description: t(`settings:voice.responseScope.${option.value}.description`),
    label: t(`settings:voice.responseScope.${option.value}.label`),
    value: option.value,
  }));

  return (
    <View className={cn(stylesClasses.section)}>
      <SettingSelectField
        label={t('settings:voice.responseScope.label')}
        onValueChange={(value) => updateChatPreferences({ responseScope: value })}
        options={responseScopeOptions}
        palette={palette}
        selectedValue={selectedResponseScope.value}
        valueLabel={t(`settings:voice.responseScope.${selectedResponseScope.value}.label`)}
      />
      <FieldDescription  invalid={false}>{t(`settings:voice.responseScope.${selectedResponseScope.value}.description`)}</FieldDescription>
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

const stylesClasses = {
  "section": "gap-2.5 pb-2"
} as const;
