import { Platform } from 'react-native';

// IIG Design System - Warm Paper (light) / Charcoal Room (dark)
const tintColorLight = '#8F1D1D'; // oxidrot primary
const tintColorDark = '#D2A650'; // amber dark accent

export const Colors = {
  light: {
    text: '#2A2A2A',
    background: '#F6F2EB',
    surface: '#F4F0EA',
    surfaceAlt: '#E8DFD0',
    card: '#F8F4EE',
    tint: tintColorLight,
    accent: '#B4362E',
    muted: '#6B6258',
    border: '#D7CAB8',
    icon: '#8A7D70',
    success: '#3F6B42',
    warning: '#A8741F',
    danger: '#B35A3C',
    bubbleUser: '#8F1D1D',
    onBubbleUser: '#F6F2EB',
    bubbleAssistant: '#E8DFD0',
    onBubbleAssistant: '#2A2A2A',
    tabBackground: '#F4F0EA',
    tabIconDefault: '#8A7D70',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#F2E9DC',
    background: '#1A1D21',
    surface: '#15171A',
    surfaceAlt: '#24272B',
    card: '#2C3035',
    tint: tintColorDark,
    accent: '#B4362E',
    muted: '#B7AA98',
    border: '#3D3832',
    icon: '#988C7D',
    success: '#6D916F',
    warning: '#B9852D',
    danger: '#C07555',
    bubbleUser: '#8F1D1D',
    onBubbleUser: '#F2E9DC',
    bubbleAssistant: '#24272B',
    onBubbleAssistant: '#F2E9DC',
    tabBackground: '#15171A',
    tabIconDefault: '#988C7D',
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
