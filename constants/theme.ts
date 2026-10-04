import { Platform } from 'react-native';

import type { AccentRoles } from '@/constants/accent';

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
    accentForeground: '#FFFFFF',
    accentMuted: '#E7EFEA',
    accentOnMuted: '#172126',
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
    accentForeground: '#08110F',
    accentMuted: '#20302C',
    accentOnMuted: '#EAF3EF',
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

export type Palette = typeof Colors.light;

// The base palette carries sensible Opencode defaults; the resolved accent
// roles override only the interactive accent tokens. Keeping the base values
// unchanged means every non-accent token (surfaces, text, status colors, message
// bubbles) is normally identical to the previous theme.
export function buildPalette(scheme: 'light' | 'dark', roles: AccentRoles): Palette {
  const base = Colors[scheme];
  return {
    ...base,
    tint: roles.accent,
    tabIconSelected: roles.accent,
    accentForeground: roles.accentForeground,
    accentMuted: roles.accentMuted,
    accentOnMuted: roles.accentOnMuted,
  };
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
