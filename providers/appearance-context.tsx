import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';

import { DEFAULT_ACCENT_COLOR, type AccentColor, type ColorScheme } from '@/constants/appearance';
import { useSystemColorScheme } from '@/hooks/use-system-color-scheme';

export type Appearance = {
  scheme: ColorScheme;
  accent: AccentColor;
};

// The root shell provides the effective appearance once preferences hydrate.
// Components rendered outside the provider (tests, isolated previews) fall back
// to the system scheme so existing call sites keep working unchanged.
const AppearanceContext = createContext<Appearance | undefined>(undefined);

export function AppearanceProvider({ children, value }: PropsWithChildren<{ value: Appearance }>) {
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): Appearance {
  const value = useContext(AppearanceContext);
  const scheme = useSystemColorScheme();
  const fallback = useMemo<Appearance>(() => ({ scheme, accent: DEFAULT_ACCENT_COLOR }), [scheme]);
  return value ?? fallback;
}
