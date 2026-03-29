import { Platform } from 'react-native';

const tintColorLight = '#0F8A6C';
const tintColorDark = '#6EE7B7';

export const Colors = {
  light: {
    text: '#172126',
    background: '#F5F7F7',
    surface: '#FFFFFF',
    surfaceAlt: '#EAF0EE',
    card: '#FFFFFF',
    tint: tintColorLight,
    accent: '#0B6B54',
    muted: '#66767A',
    border: '#D9E1DF',
    icon: '#8B989B',
    success: '#147D64',
    warning: '#A56A0D',
    danger: '#B64545',
    bubbleUser: '#0F1720',
    bubbleAssistant: '#FFFFFF',
    tabBackground: '#FBFCFC',
    tabIconDefault: '#8B989B',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECF3F1',
    background: '#101615',
    surface: '#171F1E',
    surfaceAlt: '#22302E',
    card: '#171F1E',
    tint: tintColorDark,
    accent: '#58D4AB',
    muted: '#93A6A4',
    border: '#2A3B38',
    icon: '#7C918E',
    success: '#58D4AB',
    warning: '#E6B35A',
    danger: '#F08A8A',
    bubbleUser: '#E9F4EF',
    bubbleAssistant: '#171F1E',
    tabBackground: '#121918',
    tabIconDefault: '#7C918E',
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
