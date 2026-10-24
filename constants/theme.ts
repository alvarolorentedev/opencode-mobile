import { Platform } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { DEFAULT_ACCENT_COLOR, type AccentColor, type ColorScheme } from '@/constants/appearance';

export { ACCENT_COLORS, DEFAULT_ACCENT_COLOR, DEFAULT_THEME_MODE, THEME_MODES } from '@/constants/appearance';
export type { AccentColor, ColorScheme, ThemeMode } from '@/constants/appearance';

const tintColorLight = '#0F8A6C';
const tintColorDark = '#7AE7C0';

type CodeSyntaxPalette = NonNullable<NonNullable<MarkdownStyle['codeBlock']>['syntaxColors']>;

export type CodePalette = {
  background: string;
  border: string;
  syntax: CodeSyntaxPalette;
};

// Opaque code surfaces keep Markdown readable regardless of the bubble or
// blockquote behind them. The syntax palettes match GitHub's light and dark
// token colors; inheriting tokens fall back to the code block's text color.
const lightCodePalette: CodePalette = {
  background: '#E7EFEA',
  border: '#D6E1DC',
  syntax: {
    keyword: '#CF222E',
    string: '#0A3069',
    number: '#0550AE',
    constant: '#0550AE',
    comment: '#6E7781',
    function: '#8250DF',
    type: '#953800',
    property: '#0550AE',
    tag: '#116329',
    attribute: '#0550AE',
  },
};

const darkCodePalette: CodePalette = {
  background: '#0F1614',
  border: '#2B3C38',
  syntax: {
    keyword: '#FF7B72',
    string: '#A5D6FF',
    number: '#79C0FF',
    constant: '#79C0FF',
    comment: '#8B949E',
    function: '#D2A8FF',
    type: '#FFA657',
    property: '#79C0FF',
    tag: '#7EE787',
    attribute: '#79C0FF',
  },
};

export const Colors = {
  light: {
    text: '#172126',
    background: '#F4F7F4',
    surface: '#FCFDFC',
    surfaceAlt: '#E7EFEA',
    card: '#FFFFFF',
    tint: tintColorLight,
    accent: '#125F53',
    muted: '#667874',
    border: '#D6E1DC',
    icon: '#8B989B',
    success: '#147D64',
    warning: '#A56A0D',
    danger: '#B64545',
    bubbleUser: '#135C4E',
    onBubbleUser: '#F5FFFB',
    bubbleAssistant: '#EEF4F1',
    onBubbleAssistant: '#182320',
    tabBackground: '#F9FBFA',
    tabIconDefault: '#8B989B',
    tabIconSelected: tintColorLight,
    code: lightCodePalette,
  },
  dark: {
    text: '#EAF3EF',
    background: '#0F1614',
    surface: '#16201D',
    surfaceAlt: '#20302C',
    card: '#16201D',
    tint: tintColorDark,
    accent: '#58D4AB',
    muted: '#9AADA8',
    border: '#2B3C38',
    icon: '#839793',
    success: '#63D9B1',
    warning: '#E6B35A',
    danger: '#F08A8A',
    bubbleUser: '#1C6B5C',
    onBubbleUser: '#F3FFFB',
    bubbleAssistant: '#182320',
    onBubbleAssistant: '#EAF3EF',
    tabBackground: '#121A18',
    tabIconDefault: '#839793',
    tabIconSelected: tintColorDark,
    code: darkCodePalette,
  },
};

export type Palette = typeof Colors.light;

// Accent presets only override interactive tokens. Neutral backgrounds,
// borders, cards, assistant bubbles, and code palettes stay shared so the
// default green theme is byte-for-byte the original palette and every other
// accent keeps the same contrast structure.
type AccentTokens = Pick<Palette, 'accent' | 'bubbleUser' | 'onBubbleUser' | 'tabIconSelected' | 'tint'>;

export const ACCENT_PALETTES: Record<AccentColor, Record<ColorScheme, AccentTokens>> = {
  green: {
    light: { tint: tintColorLight, accent: '#125F53', bubbleUser: '#135C4E', onBubbleUser: '#F5FFFB', tabIconSelected: tintColorLight },
    dark: { tint: tintColorDark, accent: '#58D4AB', bubbleUser: '#1C6B5C', onBubbleUser: '#F3FFFB', tabIconSelected: tintColorDark },
  },
  blue: {
    light: { tint: '#1F6FB2', accent: '#164E7C', bubbleUser: '#14486B', onBubbleUser: '#F4FAFF', tabIconSelected: '#1F6FB2' },
    dark: { tint: '#7CC4FF', accent: '#58A6E0', bubbleUser: '#1B5B82', onBubbleUser: '#F2FAFF', tabIconSelected: '#7CC4FF' },
  },
  red: {
    light: { tint: '#B03A48', accent: '#7E2733', bubbleUser: '#6E222C', onBubbleUser: '#FFF5F6', tabIconSelected: '#B03A48' },
    dark: { tint: '#FF9A9A', accent: '#E07A7A', bubbleUser: '#7A2E35', onBubbleUser: '#FFF5F6', tabIconSelected: '#FF9A9A' },
  },
  purple: {
    light: { tint: '#7A4BC4', accent: '#5A3396', bubbleUser: '#4A2A78', onBubbleUser: '#F8F4FF', tabIconSelected: '#7A4BC4' },
    dark: { tint: '#C9A8FF', accent: '#A985E8', bubbleUser: '#553A85', onBubbleUser: '#F8F4FF', tabIconSelected: '#C9A8FF' },
  },
  pink: {
    light: { tint: '#B93E78', accent: '#8C2C59', bubbleUser: '#75264B', onBubbleUser: '#FFF4F9', tabIconSelected: '#B93E78' },
    dark: { tint: '#FFA6CF', accent: '#E080B3', bubbleUser: '#7E3560', onBubbleUser: '#FFF4F9', tabIconSelected: '#FFA6CF' },
  },
  gray: {
    light: { tint: '#5B6664', accent: '#434C4A', bubbleUser: '#3B4442', onBubbleUser: '#F7FAF9', tabIconSelected: '#5B6664' },
    dark: { tint: '#C3CECB', accent: '#9FADA9', bubbleUser: '#49524F', onBubbleUser: '#F7FAF9', tabIconSelected: '#C3CECB' },
  },
};

export function getColors(scheme: ColorScheme, accent: AccentColor = DEFAULT_ACCENT_COLOR): Palette {
  return { ...Colors[scheme], ...ACCENT_PALETTES[accent][scheme] };
}

export const Fonts = Platform.select({
  ios: {
    sans: 'Avenir Next',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
    display: 'Avenir Next',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
    display: 'normal',
  },
  web: {
    sans: "'Avenir Next', 'Segoe UI', 'Trebuchet MS', sans-serif",
    serif: "Charter, 'Iowan Old Style', Georgia, serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    display: "'Avenir Next', 'Segoe UI', 'Trebuchet MS', sans-serif",
  },
});
