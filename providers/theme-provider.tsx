import { Color, DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { resolveStaticAccent, type AccentMode, type AccentRoles } from '@/constants/accent';
import { getPaperTheme } from '@/constants/paper-theme';
import { buildPalette, type Palette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePreferences } from '@/providers/opencode-contexts';

export type AppTheme = {
  palette: Palette;
  scheme: 'light' | 'dark';
  accentMode: AccentMode;
};

const AppThemeContext = createContext<AppTheme | null>(null);

// `Color.android.dynamic` resolves Material 3 Dynamic Color through the
// existing expo-router native module and returns a hex string (or null off
// Android). It is only meaningful on Android 12+ (API 31); below that the
// Material 3 dynamic themes fall back to the baseline palette, so the caller
// uses the Opencode accent instead.
function dynamicAccentRoles(): AccentRoles | undefined {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) {
    return undefined;
  }

  const dynamic = Color.android.dynamic as unknown as Record<string, unknown>;
  const read = (name: string) => {
    const value = dynamic[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  const accent = read('primary');
  const accentForeground = read('onPrimary');
  const accentMuted = read('primaryContainer');
  const accentOnMuted = read('onPrimaryContainer');
  if (!accent || !accentForeground || !accentMuted || !accentOnMuted) {
    return undefined;
  }

  return { accent, accentForeground, accentMuted, accentOnMuted };
}

function resolveAccentRoles(scheme: 'light' | 'dark', mode: AccentMode): AccentRoles {
  if (mode === 'system') {
    return dynamicAccentRoles() ?? resolveStaticAccent(scheme, 'opencode');
  }

  return resolveStaticAccent(scheme, mode);
}

function getNavigationTheme(scheme: 'light' | 'dark', palette: Palette) {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.tint,
      background: palette.background,
      card: palette.surface,
      text: palette.text,
      border: palette.border,
      notification: palette.tint,
    },
  };
}

// Resolves the user's accent preference plus the OS color scheme into the
// app-wide palette and configures Paper and React Navigation. This is the only
// place that knows about platform accent resolution; screens and components
// consume the resolved palette through `useAppTheme()`.
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const { chatPreferences } = usePreferences();
  const accentMode: AccentMode = chatPreferences.accent;

  const roles = useMemo(() => resolveAccentRoles(scheme, accentMode), [accentMode, scheme]);
  const palette = useMemo(() => buildPalette(scheme, roles), [roles, scheme]);
  const paperTheme = useMemo(() => getPaperTheme(scheme, palette), [palette, scheme]);
  const navigationTheme = useMemo(() => getNavigationTheme(scheme, palette), [palette, scheme]);
  const value = useMemo<AppTheme>(() => ({ palette, scheme, accentMode }), [accentMode, palette, scheme]);

  return (
    <AppThemeContext.Provider value={value}>
      <PaperProvider theme={paperTheme}>
        <ThemeProvider value={navigationTheme}>{children}</ThemeProvider>
      </PaperProvider>
    </AppThemeContext.Provider>
  );
}

export function useAppTheme(): AppTheme {
  const value = useContext(AppThemeContext);
  if (!value) {
    throw new Error('useAppTheme must be used inside AppThemeProvider.');
  }
  return value;
}

export function usePalette(): Palette {
  return useAppTheme().palette;
}
