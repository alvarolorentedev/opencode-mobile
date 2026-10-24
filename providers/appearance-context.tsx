import { createContext, useContext, type PropsWithChildren } from 'react';

import { DEFAULT_ACCENT_COLOR, type AccentColor, type ColorScheme } from '@/constants/appearance';
import { getColors, type Palette } from '@/constants/theme';

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
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): Appearance {
  return useContext(AppearanceContext) ?? FALLBACK_APPEARANCE;
}
