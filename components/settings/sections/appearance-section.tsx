import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { HelperText, Text } from 'react-native-paper';
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

      <SettingTarget label={t('settings:appearance.accent.label')}>
      <Text variant="titleSmall" style={[styles.accentTitle, { color: palette.text }]}>
        {t('settings:appearance.accent.label')}
      </Text>
      <View style={styles.swatches}>
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
              <View style={[styles.swatch, { backgroundColor: preview.background, borderColor: preview.border }]}>
                <View style={[styles.swatchSurface, { backgroundColor: preview.surface, borderColor: preview.border }]}>
                  <View style={[styles.swatchAccent, { backgroundColor: preview.tint }]}>
                    {selected ? <MaterialCommunityIcons name="check" size={12} color={preview.background} /> : null}
                  </View>
                </View>
              </View>
              <Text variant="labelMedium" style={{ color: selected ? palette.text : palette.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <HelperText type="info">{t('settings:appearance.accent.description')}</HelperText>
      </SettingTarget>
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
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  swatch: { alignItems: 'center', borderRadius: 8, borderWidth: 1, height: 24, justifyContent: 'center', width: 28 },
  swatchSurface: { alignItems: 'center', borderRadius: 4, borderWidth: 1, height: 16, justifyContent: 'center', width: 20 },
  swatchAccent: { alignItems: 'center', borderRadius: 2, height: 9, justifyContent: 'center', width: 11 },
});
