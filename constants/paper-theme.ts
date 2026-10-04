import {
  MD3DarkTheme,
  MD3LightTheme,
  type MD3Theme,
} from 'react-native-paper';

import type { Palette } from '@/constants/theme';

export function getPaperTheme(scheme: 'light' | 'dark', palette: Palette): MD3Theme {
  const base = scheme === 'dark' ? MD3DarkTheme : MD3LightTheme;

  return {
    ...base,
    roundness: 3,
    colors: {
      ...base.colors,
      primary: palette.tint,
      onPrimary: palette.accentForeground,
      primaryContainer: palette.accentMuted,
      onPrimaryContainer: palette.accentOnMuted,
      secondary: palette.tint,
      onSecondary: palette.accentForeground,
      secondaryContainer: palette.accentMuted,
      onSecondaryContainer: palette.accentOnMuted,
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
