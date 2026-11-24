import { UpdateBlockingSettingSelectField as SettingSelectField } from '@/features/updates/index';
import { cn } from '@/shared/ui/cn';
import { FieldDescription } from '@/shared/ui/text-field';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AccentColorField } from '@/shared/ui/theme/accent-color-field';
import { DEFAULT_ACCENT_COLOR, DEFAULT_THEME_MODE, type ThemeMode } from '@/shared/ui/theme/theme';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { SettingTarget } from '@/shared/ui/settings/settings-panel';
import type { Palette } from '@/shared/ui/settings/setting-rows';
import { OpeningScreenField } from '@/features/sessions/index';

export function AppearanceSection({
  chatPreferences,
  palette,
  updateChatPreferences,
}: {
  chatPreferences: ChatPreferences;
  palette: Palette;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
}) {
  const { t } = useTranslation();
  const themeMode = chatPreferences.themeMode ?? DEFAULT_THEME_MODE;
  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: t('settings:appearance.theme.system'), value: 'system' },
    { label: t('settings:appearance.theme.light'), value: 'light' },
    { label: t('settings:appearance.theme.dark'), value: 'dark' },
  ];

  return (
    <View testID="settings-appearance-section" className={cn(stylesClasses.section)}>
      <SettingSelectField<ThemeMode>
        testID="settings-theme-mode"
        label={t('settings:appearance.theme.label')}
        onValueChange={(value) => updateChatPreferences({ themeMode: value })}
        options={themeOptions}
        palette={palette}
        selectedValue={themeMode}
        valueLabel={themeOptions.find((option) => option.value === themeMode)?.label ?? themeOptions[0].label}
      />
      <FieldDescription invalid={false}>{t('settings:appearance.theme.description')}</FieldDescription>

      <OpeningScreenField value={chatPreferences.openingScreen}
        onChange={(openingScreen) => updateChatPreferences({ openingScreen })} />

      <SettingTarget label={t('settings:appearance.accent.label')}>
        <AccentColorField
          onChange={(accentColor) => updateChatPreferences({ accentColor })}
          palette={palette}
          value={chatPreferences.accentColor ?? DEFAULT_ACCENT_COLOR}
        />
      </SettingTarget>
    </View>
  );
}

const stylesClasses = {
  "section": "gap-2.5 pb-2"
} as const;
