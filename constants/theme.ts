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

const greenLightTokens = {
  tint: tintColorLight,
  accent: '#125F53',
  background: '#F4F7F4',
  surface: '#FCFDFC',
  surfaceAlt: '#E7EFEA',
  card: '#FFFFFF',
  muted: '#667874',
  border: '#D6E1DC',
  icon: '#8B989B',
  bubbleUser: '#135C4E',
  onBubbleUser: '#F5FFFB',
  bubbleAssistant: '#EEF4F1',
  tabBackground: '#F9FBFA',
  tabIconDefault: '#8B989B',
};

const greenDarkTokens = {
  tint: tintColorDark,
  accent: '#58D4AB',
  background: '#0F1614',
  surface: '#16201D',
  surfaceAlt: '#20302C',
  card: '#16201D',
  muted: '#9AADA8',
  border: '#2B3C38',
  icon: '#839793',
  bubbleUser: '#1C6B5C',
  onBubbleUser: '#F3FFFB',
  bubbleAssistant: '#182320',
  tabBackground: '#121A18',
  tabIconDefault: '#839793',
};

export const Colors = {
  light: {
    text: '#172126',
    ...greenLightTokens,
    success: '#147D64',
    warning: '#A56A0D',
    danger: '#B64545',
    onBubbleAssistant: '#182320',
    code: lightCodePalette,
  },
  dark: {
    text: '#EAF3EF',
    ...greenDarkTokens,
    success: '#63D9B1',
    warning: '#E6B35A',
    danger: '#F08A8A',
    onBubbleAssistant: '#EAF3EF',
    code: darkCodePalette,
  },
};

export type Palette = typeof Colors.light;

// Each preset is a full theme: surfaces, borders, secondary text, chat
// bubbles, and accents. Text and semantic colors (success/warning/danger) stay
// shared so contrast and meaning do not change with the theme. The green preset
// reproduces the original palette exactly.
type ThemeTokens = Pick<
  Palette,
  | 'accent'
  | 'background'
  | 'border'
  | 'bubbleAssistant'
  | 'bubbleUser'
  | 'card'
  | 'icon'
  | 'muted'
  | 'onBubbleUser'
  | 'surface'
  | 'surfaceAlt'
  | 'tabBackground'
  | 'tabIconDefault'
  | 'tint'
>;

export const ACCENT_PALETTES: Record<AccentColor, Record<ColorScheme, ThemeTokens>> = {
  green: {
    light: greenLightTokens,
    dark: greenDarkTokens,
  },
  blue: {
    light: {
      tint: '#1F6FB2', accent: '#164E7C', background: '#F1F5F9', surface: '#FBFCFE', surfaceAlt: '#E5EDF5', card: '#FFFFFF',
      muted: '#61707E', border: '#D2DDE9', icon: '#8794A2', bubbleUser: '#14486B', onBubbleUser: '#F4FAFF',
      bubbleAssistant: '#EBF1F8', tabBackground: '#F7FAFC', tabIconDefault: '#8794A2',
    },
    dark: {
      tint: '#7CC4FF', accent: '#58A6E0', background: '#0D1217', surface: '#151C23', surfaceAlt: '#1E2934', card: '#151C23',
      muted: '#96A6B5', border: '#293542', icon: '#81909F', bubbleUser: '#1B5B82', onBubbleUser: '#F2FAFF',
      bubbleAssistant: '#171F27', tabBackground: '#10161C', tabIconDefault: '#81909F',
    },
  },
  red: {
    light: {
      tint: '#B03A48', accent: '#7E2733', background: '#FAF4F4', surface: '#FEFBFB', surfaceAlt: '#F5E7E8', card: '#FFFFFF',
      muted: '#7D686C', border: '#E8D5D7', icon: '#9B868A', bubbleUser: '#6E222C', onBubbleUser: '#FFF5F6',
      bubbleAssistant: '#F8EEEF', tabBackground: '#FCF8F8', tabIconDefault: '#9B868A',
    },
    dark: {
      tint: '#FF9A9A', accent: '#E07A7A', background: '#171010', surface: '#221819', surfaceAlt: '#2F2122', card: '#221819',
      muted: '#AF9A9D', border: '#3D2C2E', icon: '#998588', bubbleUser: '#7A2E35', onBubbleUser: '#FFF5F6',
      bubbleAssistant: '#21181A', tabBackground: '#1A1213', tabIconDefault: '#998588',
    },
  },
  purple: {
    light: {
      tint: '#7A4BC4', accent: '#5A3396', background: '#F7F4FB', surface: '#FDFBFE', surfaceAlt: '#EDE6F6', card: '#FFFFFF',
      muted: '#71697E', border: '#DBD2EA', icon: '#8F879C', bubbleUser: '#4A2A78', onBubbleUser: '#F8F4FF',
      bubbleAssistant: '#F1ECF9', tabBackground: '#FAF7FD', tabIconDefault: '#8F879C',
    },
    dark: {
      tint: '#C9A8FF', accent: '#A985E8', background: '#120F17', surface: '#1B1622', surfaceAlt: '#271F33', card: '#1B1622',
      muted: '#A99FB8', border: '#342A43', icon: '#958BA3', bubbleUser: '#553A85', onBubbleUser: '#F8F4FF',
      bubbleAssistant: '#1A1521', tabBackground: '#15111B', tabIconDefault: '#958BA3',
    },
  },
  pink: {
    light: {
      tint: '#B93E78', accent: '#8C2C59', background: '#FBF4F7', surface: '#FEFBFC', surfaceAlt: '#F6E7EE', card: '#FFFFFF',
      muted: '#7F6873', border: '#E8D5DE', icon: '#9C8791', bubbleUser: '#75264B', onBubbleUser: '#FFF4F9',
      bubbleAssistant: '#F9EEF3', tabBackground: '#FCF8FA', tabIconDefault: '#9C8791',
    },
    dark: {
      tint: '#FFA6CF', accent: '#E080B3', background: '#171013', surface: '#22171B', surfaceAlt: '#302027', card: '#22171B',
      muted: '#AF9AA3', border: '#3E2B33', icon: '#99858E', bubbleUser: '#7E3560', onBubbleUser: '#FFF4F9',
      bubbleAssistant: '#21171B', tabBackground: '#1A1215', tabIconDefault: '#99858E',
    },
  },
  gray: {
    light: {
      tint: '#5B6664', accent: '#434C4A', background: '#F4F5F5', surface: '#FBFBFB', surfaceAlt: '#E8EAEA', card: '#FFFFFF',
      muted: '#6A7170', border: '#D6D9D9', icon: '#8C9291', bubbleUser: '#3B4442', onBubbleUser: '#F7FAF9',
      bubbleAssistant: '#EFF1F1', tabBackground: '#F8F9F9', tabIconDefault: '#8C9291',
    },
    dark: {
      tint: '#C3CECB', accent: '#9FADA9', background: '#101212', surface: '#181B1B', surfaceAlt: '#222626', card: '#181B1B',
      muted: '#A0A6A5', border: '#2D3232', icon: '#8B9190', bubbleUser: '#49524F', onBubbleUser: '#F7FAF9',
      bubbleAssistant: '#191C1C', tabBackground: '#131616', tabIconDefault: '#8B9190',
    },
  },
};

export function getColors(scheme: ColorScheme, accent: AccentColor = DEFAULT_ACCENT_COLOR): Palette {
  const palette = { ...Colors[scheme], ...ACCENT_PALETTES[accent][scheme] };
  return {
    ...palette,
    // Code surfaces follow the themed neutral surfaces while the syntax token
    // colors stay in the shared GitHub light/dark palettes.
    code: {
      ...Colors[scheme].code,
      background: scheme === 'light' ? palette.surfaceAlt : palette.background,
      border: palette.border,
    },
  };
}

export const Fonts = Platform.select({
  ios: {
    sans: 'Avenir Next',
    mono: 'ui-monospace',
    display: 'Avenir Next',
  },
  default: {
    sans: 'normal',
    mono: 'monospace',
    display: 'normal',
  },
  web: {
    sans: "'Avenir Next', 'Segoe UI', 'Trebuchet MS', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    display: "'Avenir Next', 'Segoe UI', 'Trebuchet MS', sans-serif",
  },
});
