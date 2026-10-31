import { createContext, useContext, useLayoutEffect, type PropsWithChildren } from 'react';

import { Uniwind } from 'uniwind';

import { DEFAULT_ACCENT_COLOR, type AccentColor, type ColorScheme } from '@/constants/appearance';
import { getColors, getUiVariables, type Palette } from '@/constants/theme';

export type Appearance = {
  scheme: ColorScheme;
  accent: AccentColor;
  palette: Palette;
};

// Components rendered outside the provider (tests, isolated previews) use this
// static fallback. Production always receives the effective appearance from
// AppearanceHost, so the system scheme is subscribed exactly once there.
const FALLBACK_APPEARANCE: Appearance = {
  scheme: 'light',
  accent: DEFAULT_ACCENT_COLOR,
  palette: getColors('light', DEFAULT_ACCENT_COLOR),
};

const AppearanceContext = createContext<Appearance | undefined>(undefined);

export function AppearanceProvider({ children, value }: PropsWithChildren<{ value: Appearance }>) {
  useLayoutEffect(() => {
    Uniwind.updateCSSVariables('light', getUiVariables('light', value.accent));
    Uniwind.updateCSSVariables('dark', getUiVariables('dark', value.accent));
    Uniwind.setTheme(value.scheme);
  }, [value.scheme, value.accent]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): Appearance {
  return useContext(AppearanceContext) ?? FALLBACK_APPEARANCE;
}
