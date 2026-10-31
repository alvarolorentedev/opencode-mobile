// Appearance preferences shared by the persisted preference model and the
// palette. Kept free of React Native imports so parsing tests can load it
// without a UI runtime.

export type ColorScheme = 'light' | 'dark';

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
export const DEFAULT_THEME_MODE: ThemeMode = 'system';

export type AccentColor = 'green' | 'blue' | 'red' | 'purple' | 'pink' | 'gray';
export const ACCENT_COLORS: readonly AccentColor[] = ['green', 'blue', 'red', 'purple', 'pink', 'gray'];
export const DEFAULT_ACCENT_COLOR: AccentColor = 'green';
