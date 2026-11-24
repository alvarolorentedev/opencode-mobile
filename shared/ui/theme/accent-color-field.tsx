// Shared accent-color control used by Settings and onboarding. It owns only
// presentation; callers persist the selected value.

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { FieldDescription } from '@/shared/ui/text-field';
import { ACCENT_COLORS, DEFAULT_ACCENT_COLOR, getColors, type AccentColor, type Palette } from '@/shared/ui/theme/theme';
import { useColorScheme } from '@/shared/ui/theme/use-color-scheme';

export function AccentColorField({ value, onChange, palette }: {
  value?: AccentColor;
  onChange: (accent: AccentColor) => void;
  palette: Palette;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const accentColor = value ?? DEFAULT_ACCENT_COLOR;

  return (
    <View className={cn(stylesClasses.field)}>
      <Text className={cn(stylesClasses.title, "text-foreground")} variant="description">{t('settings:appearance.accent.label')}</Text>
      <View className={cn(stylesClasses.swatches)}>
        {ACCENT_COLORS.map((accent) => {
          const selected = accent === accentColor;
          const label = t(`settings:appearance.accent.${accent}`);
          const preview = getColors(scheme, accent);
          return (
            <Pressable
              key={accent}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={label}
              aria-checked={selected}
              onPress={() => onChange(accent)}
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
      <FieldDescription invalid={false}>{t('settings:appearance.accent.description')}</FieldDescription>
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
  "field": "gap-2.5",
  "title": "font-semibold",
  "swatches": "flex-row flex-wrap gap-2",
  "swatch": "items-center rounded-[8px] border h-6 justify-center w-7",
  "swatchSurface": "items-center rounded-[4px] border h-4 justify-center w-5",
  "swatchAccent": "items-center rounded-[2px] h-2.25 justify-center w-2.75"
} as const;
