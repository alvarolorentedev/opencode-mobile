import {
  MD3DarkTheme,
  MD3LightTheme,
  type MD3Theme,
} from 'react-native-paper';

import { DEFAULT_ACCENT_COLOR, getColors, type AccentColor, type ColorScheme } from '@/constants/theme';

export function getPaperTheme(colorScheme: ColorScheme, accent: AccentColor = DEFAULT_ACCENT_COLOR): MD3Theme {
  const palette = getColors(colorScheme, accent);
  const base = colorScheme === 'dark' ? MD3DarkTheme : MD3LightTheme;

  return {
    ...base,
    roundness: 3,
    colors: {
      ...base.colors,
      primary: palette.tint,
      onPrimary: colorScheme === 'dark' ? '#08110F' : '#FFFFFF',
      primaryContainer: palette.surfaceAlt,
      onPrimaryContainer: palette.text,
      secondary: palette.accent,
      onSecondary: colorScheme === 'dark' ? '#08110F' : '#FFFFFF',
      secondaryContainer: palette.surfaceAlt,
      onSecondaryContainer: palette.text,
      error: palette.danger,
      background: palette.background,
      onBackground: palette.text,
      surface: palette.surface,
      onSurface: palette.text,
      surfaceVariant: palette.surfaceAlt,
      onSurfaceVariant: palette.muted,
      outline: palette.border,
      outlineVariant: palette.border,
      elevation: {
        ...base.colors.elevation,
        level0: palette.background,
        level1: palette.surface,
        level2: palette.card,
        level3: palette.surfaceAlt,
        level4: palette.surfaceAlt,
        level5: palette.surfaceAlt,
      },
    },
  };
}
