import { cn } from '@/lib/utils';
import { FieldDescription } from '@/components/ui/text-field';
import { Text } from '@/components/ui/text';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
  ACCENT_COLORS,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_THEME_MODE,
  getColors,
  type AccentColor,
  type ThemeMode,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ChatPreferences } from '@/providers/opencode-provider';
import { SettingTarget } from '../settings-panel';
import { SettingSelectField, type Palette } from './setting-rows';

const ACCENT_LABEL_KEYS: Record<AccentColor, string> = {
  green: 'settings:appearance.accent.green',
  blue: 'settings:appearance.accent.blue',
  red: 'settings:appearance.accent.red',
  purple: 'settings:appearance.accent.purple',
  pink: 'settings:appearance.accent.pink',
  gray: 'settings:appearance.accent.gray',
};

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
  const scheme = useColorScheme();
  const themeMode = chatPreferences.themeMode ?? DEFAULT_THEME_MODE;
  const accentColor = chatPreferences.accentColor ?? DEFAULT_ACCENT_COLOR;
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
      <FieldDescription  invalid={false}>{t('settings:appearance.theme.description')}</FieldDescription>

      <SettingTarget label={t('settings:appearance.accent.label')}>
      <Text className={cn(stylesClasses.accentTitle, "text-foreground")} variant="description">{t('settings:appearance.accent.label')}</Text>
      <View className={cn(stylesClasses.swatches)}>
        {ACCENT_COLORS.map((accent) => {
          const selected = accent === accentColor;
          const label = t(ACCENT_LABEL_KEYS[accent]);
          const preview = getColors(scheme, accent);
          return (
            <Pressable
              key={accent}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={label}
              aria-checked={selected}
              onPress={() => updateChatPreferences({ accentColor: accent })}
              testID={`settings-accent-${accent}`}
              style={({ pressed }) => [
                styles.swatchButton,
                {
                  backgroundColor: selected ? palette.surfaceAlt : palette.surface,
                  borderColor: selected ? palette.tint : palette.border,
                  opacity: pressed ? 0.82 : 1,
                },
              ]}>
              <View className={cn(stylesClasses.swatch)} style={[{ backgroundColor: preview.background, borderColor: preview.border }]}>
                <View className={cn(stylesClasses.swatchSurface)} style={[{ backgroundColor: preview.surface, borderColor: preview.border }]}>
                  <View className={cn(stylesClasses.swatchAccent)} style={[{ backgroundColor: preview.tint }]}>
                    {selected ? <MaterialCommunityIcons name="check" size={12} color={preview.background} /> : null}
                  </View>
                </View>
              </View>
              <Text style={{ color: selected ? palette.text : palette.muted }} variant="label">{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldDescription  invalid={false}>{t('settings:appearance.accent.description')}</FieldDescription>
      </SettingTarget>
    </View>
  );
}

const styles = StyleSheet.create({
  swatchButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
  }
});

const stylesClasses = {
  "section": "gap-2.5 pb-2",
  "accentTitle": "font-semibold",
  "swatches": "flex-row flex-wrap gap-2",
  "swatch": "items-center rounded-[8px] border h-6 justify-center w-7",
  "swatchSurface": "items-center rounded-[4px] border h-4 justify-center w-5",
  "swatchAccent": "items-center rounded-[2px] h-2.25 justify-center w-2.75"
} as const;
