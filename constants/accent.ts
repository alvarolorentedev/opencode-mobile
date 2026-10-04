// Accent mode model and the static accent palettes.
//
// This module is intentionally free of React Native / expo-router imports so
// the resolver, validation, and contrast behavior can be unit-tested in Node
// and imported by the preference model. Platform accent resolution (Android
// Material You) lives in providers/theme-provider.tsx.

export type AccentMode = 'system' | 'opencode' | 'blue' | 'violet' | 'orange';

export type AccentScheme = 'light' | 'dark';

export type AccentRoles = {
  // Primary interactive accent.
  accent: string;
  // Readable foreground for text/icons drawn on top of `accent`.
  accentForeground: string;
  // Low-emphasis accent surface (Material `primaryContainer` role).
  accentMuted: string;
  // Readable foreground for content on `accentMuted`.
  accentOnMuted: string;
};

export const ACCENT_MODES: AccentMode[] = ['system', 'opencode', 'blue', 'violet', 'orange'];

export function isAccentMode(value: unknown): value is AccentMode {
  return typeof value === 'string' && (ACCENT_MODES as string[]).includes(value);
}

// Static accents for explicit modes. `system` shares the Opencode fallback and
// is resolved separately on platforms that expose a user accent.
const STATIC_ACCENTS: Record<AccentMode, Record<AccentScheme, AccentRoles>> = {
  system: {
    light: { accent: '#0F8A6C', accentForeground: '#FFFFFF', accentMuted: '#E7EFEA', accentOnMuted: '#172126' },
    dark: { accent: '#7AE7C0', accentForeground: '#08110F', accentMuted: '#20302C', accentOnMuted: '#EAF3EF' },
  },
  opencode: {
    light: { accent: '#0F8A6C', accentForeground: '#FFFFFF', accentMuted: '#E7EFEA', accentOnMuted: '#172126' },
    dark: { accent: '#7AE7C0', accentForeground: '#08110F', accentMuted: '#20302C', accentOnMuted: '#EAF3EF' },
  },
  blue: {
    light: { accent: '#1D4ED8', accentForeground: '#FFFFFF', accentMuted: '#E4E9FB', accentOnMuted: '#12235E' },
    dark: { accent: '#9DB6FF', accentForeground: '#0A1220', accentMuted: '#23304F', accentOnMuted: '#DCE5FF' },
  },
  violet: {
    light: { accent: '#6D28D9', accentForeground: '#FFFFFF', accentMuted: '#EDE6FB', accentOnMuted: '#2E1065' },
    dark: { accent: '#C9B4FF', accentForeground: '#140A2E', accentMuted: '#322A4D', accentOnMuted: '#E9DEFF' },
  },
  orange: {
    light: { accent: '#B45309', accentForeground: '#FFFFFF', accentMuted: '#F7E7D3', accentOnMuted: '#5A2C05' },
    dark: { accent: '#FFB77D', accentForeground: '#2A1400', accentMuted: '#43301F', accentOnMuted: '#FFDCC2' },
  },
};

export function resolveStaticAccent(scheme: AccentScheme, mode: AccentMode): AccentRoles {
  return STATIC_ACCENTS[mode][scheme];
}

export function getAccentPreviewColor(mode: AccentMode, scheme: AccentScheme): string {
  return resolveStaticAccent(scheme, mode).accent;
}
