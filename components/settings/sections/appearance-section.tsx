import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
  ACCENT_COLORS,
  ACCENT_PALETTES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_THEME_MODE,
  type AccentColor,
  type ThemeMode,
} from '@/constants/theme';
import type { ChatPreferences } from '@/providers/opencode-provider';
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
  const themeMode = chatPreferences.themeMode ?? DEFAULT_THEME_MODE;
  const accentColor = chatPreferences.accentColor ?? DEFAULT_ACCENT_COLOR;
  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: t('settings:appearance.theme.system'), value: 'system' },
    { label: t('settings:appearance.theme.light'), value: 'light' },
    { label: t('settings:appearance.theme.dark'), value: 'dark' },
  ];

  return (
    <View testID="settings-appearance-section" style={styles.section}>
      <SettingSelectField<ThemeMode>
        testID="settings-theme-mode"
        label={t('settings:appearance.theme.label')}
        onValueChange={(value) => updateChatPreferences({ themeMode: value })}
        options={themeOptions}
        palette={palette}
        selectedValue={themeMode}
        valueLabel={themeOptions.find((option) => option.value === themeMode)?.label ?? themeOptions[0].label}
      />
      <HelperText type="info">{t('settings:appearance.theme.description')}</HelperText>

      <Text variant="titleSmall" style={[styles.accentTitle, { color: palette.text }]}>
        {t('settings:appearance.accent.label')}
      </Text>
      <View style={styles.swatches}>
        {ACCENT_COLORS.map((accent) => {
          const selected = accent === accentColor;
          const label = t(ACCENT_LABEL_KEYS[accent]);
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
                  borderColor: selected ? palette.tint : palette.border,
                  opacity: pressed ? 0.82 : 1,
                },
              ]}>
              <View style={[styles.swatch, { backgroundColor: ACCENT_PALETTES[accent].light.tint }]}>
                {selected ? <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" /> : null}
              </View>
              <Text variant="labelMedium" style={{ color: selected ? palette.text : palette.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <HelperText type="info">{t('settings:appearance.accent.description')}</HelperText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, paddingBottom: 8 },
  accentTitle: { fontWeight: '600' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatchButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  swatch: { alignItems: 'center', borderRadius: 9, height: 18, justifyContent: 'center', width: 18 },
});
