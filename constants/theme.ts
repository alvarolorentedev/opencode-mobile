import { Platform } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';
import tokens from './ui-tokens.json';
import { DEFAULT_ACCENT_COLOR, type AccentColor, type ColorScheme } from './appearance';
export { ACCENT_COLORS, DEFAULT_ACCENT_COLOR, DEFAULT_THEME_MODE, THEME_MODES } from './appearance';
export type { AccentColor, ColorScheme, ThemeMode } from './appearance';
export type CodePalette = { background: string; border: string; syntax: NonNullable<NonNullable<MarkdownStyle['codeBlock']>['syntaxColors']> };
function basePalette(scheme: ColorScheme) {
  const neutral = tokens.presets.green[scheme];
  return { ...tokens.colors[scheme], ...neutral, code: { ...tokens.colors[scheme].code, background: scheme === 'light' ? neutral.surfaceAlt : neutral.background, border: neutral.border } };
}
export const Colors = { light: basePalette('light'), dark: basePalette('dark') };
export type Palette = typeof Colors.light;
export const ACCENT_PALETTES = tokens.presets;
export function getColors(scheme: ColorScheme, accent: AccentColor = DEFAULT_ACCENT_COLOR): Palette {
  const palette = { ...Colors[scheme], ...ACCENT_PALETTES[accent][scheme] };
  return { ...palette, code: { ...palette.code, background: scheme === 'light' ? palette.surfaceAlt : palette.background, border: palette.border } };
}
export function getUiVariables(scheme: ColorScheme, accent: AccentColor = DEFAULT_ACCENT_COLOR): Record<string, string> {
  const palette = getColors(scheme, accent);
  return Object.fromEntries(Object.entries(tokens.aliases).map(([alias, role]) => ['--color-' + alias, palette[role as keyof Omit<Palette, 'code'>]]));
}
export const Fonts = Platform.select(tokens.fonts)!;
