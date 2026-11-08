import { useTranslation } from 'react-i18next';

import { OPENING_SCREENS, type OpeningScreen } from '@/shared/preferences/opencode-preferences';
import { SettingSelectField } from '@/shared/ui/settings/setting-rows';
import { usePalette } from '@/shared/ui/theme/use-palette';

export function OpeningScreenField({ value, onChange }: { value: OpeningScreen; onChange: (value: OpeningScreen) => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const labels = { chat: t('common:tabs.chat'), mission: t('chat:mission.title') };
  return <SettingSelectField testID="opening-screen-picker" label={t('settings:general.openingScreen')} palette={palette}
    options={OPENING_SCREENS.map((screen) => ({ value: screen, label: labels[screen] }))}
    selectedValue={value} valueLabel={labels[value]} onValueChange={onChange} />;
}
