import { useTranslation } from 'react-i18next';
import { HelperText } from 'react-native-paper';

import { TIMELINE_DETAIL_ORDER, type TimelineDetail } from '@/lib/opencode/transcript';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { SettingSelectField, SettingSlider, type Palette } from './setting-rows';

type PreferenceFieldProps = {
  chatPreferences: ChatPreferences;
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
};

export function TimelineDetailField({ chatPreferences, palette, updateChatPreferences }: PreferenceFieldProps) {
  const { t } = useTranslation();
  const timelineDetail: TimelineDetail = TIMELINE_DETAIL_ORDER.includes(chatPreferences.timelineDetail)
    ? chatPreferences.timelineDetail
    : 'everything';

  return (
    <>
      <SettingSlider
        label={t('settings:appearance.timelineDetail.label')}
        maximum={TIMELINE_DETAIL_ORDER.length - 1}
        minimum={0}
        step={1}
        testID="settings-timeline-detail"
        value={TIMELINE_DETAIL_ORDER.indexOf(timelineDetail)}
        valueLabel={t(`settings:appearance.timelineDetail.${timelineDetail}.label`)}
        onValueChange={(index) => {
          const next = TIMELINE_DETAIL_ORDER[Math.round(index)];
          if (next) updateChatPreferences({ timelineDetail: next });
        }}
        palette={palette}
      />
      <HelperText type="info">{t(`settings:appearance.timelineDetail.${timelineDetail}.description`)}</HelperText>
    </>
  );
}

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
