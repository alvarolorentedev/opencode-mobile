import { Platform } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

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
