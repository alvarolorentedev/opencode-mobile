import { FieldDescription } from '@/shared/ui/text-field';
import { useTranslation } from 'react-i18next';

import { TIMELINE_DETAIL_ORDER, type TimelineDetail } from '@/shared/presentation/transcript';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { SettingSelectField, SettingSlider, type Palette } from '@/shared/ui/settings/setting-rows';

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
      <FieldDescription  invalid={false}>{t(`settings:appearance.timelineDetail.${timelineDetail}.description`)}</FieldDescription>
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
