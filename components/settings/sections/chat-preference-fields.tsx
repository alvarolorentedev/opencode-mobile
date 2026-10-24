import { useTranslation } from 'react-i18next';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { SettingSelectField, type Palette } from './setting-rows';

type PreferenceFieldProps = {
  chatPreferences: ChatPreferences;
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
};

export function PromptDeliveryField({ chatPreferences, palette, updateChatPreferences }: PreferenceFieldProps) {
  const { t } = useTranslation();
  return (
    <SettingSelectField
      testID="settings-prompt-delivery"
      label={t('settings:providers.promptDelivery.label')}
      valueLabel={t(`settings:providers.promptDelivery.${chatPreferences.promptDelivery || 'steer'}.label`)}
      selectedValue={chatPreferences.promptDelivery || 'steer'}
      options={(['steer', 'queue'] as const).map((value) => ({ value, label: t(`settings:providers.promptDelivery.${value}.label`), description: t(`settings:providers.promptDelivery.${value}.description`) }))}
      onValueChange={(promptDelivery) => updateChatPreferences({ promptDelivery })}
      palette={palette}
    />
  );
}
