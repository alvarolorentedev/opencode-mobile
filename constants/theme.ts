import { Platform } from 'react-native';

const tintColorLight = '#0F8A6C';
const tintColorDark = '#7AE7C0';

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
