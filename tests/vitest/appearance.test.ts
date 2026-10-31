import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import tokens from '@/constants/ui-tokens.json';
import { cn } from '@/lib/utils';

import {
  ACCENT_COLORS,
  ACCENT_PALETTES,
  Colors,
  getColors,
  getUiVariables,
} from '@/constants/theme';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: (value: Record<string, unknown>) => value.web ?? value.default },
}));

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe('theme palette presets', () => {
  it('merges typography independently from semantic text colors', () => {
    expect(cn('text-body text-foreground', 'text-title text-primary')).toBe('text-title text-primary');
  });
  it('keeps generated CSS in sync with the authoritative tokens', () => {
    expect(() => execFileSync(process.execPath, ['scripts/gen-ui-tokens.mjs', '--check'])).not.toThrow();
  });
  it('exposes the six expected themes in a stable order', () => {
    expect(ACCENT_COLORS).toEqual(['green', 'blue', 'red', 'purple', 'pink', 'gray']);
  });

  it('projects the default green tokens without a second palette', () => {
    expect(getColors('light', 'green')).toEqual(Colors.light);
    expect(getColors('dark', 'green')).toEqual(Colors.dark);
  });

  it.each(ACCENT_COLORS)('defines full surface and accent tokens for %s', (accent) => {
    for (const scheme of ['light', 'dark'] as const) {
      const palette = getColors(scheme, accent);
      const tokens = ACCENT_PALETTES[accent][scheme];
      expect(palette.tint).toBe(tokens.tint);
      expect(palette.accent).toBe(tokens.accent);
      expect(palette.background).toBe(tokens.background);
      expect(palette.surface).toBe(tokens.surface);
      expect(palette.surfaceAlt).toBe(tokens.surfaceAlt);
      expect(palette.card).toBe(tokens.card);
      expect(palette.border).toBe(tokens.border);
      expect(palette.muted).toBe(tokens.muted);
      expect(palette.bubbleAssistant).toBe(tokens.bubbleAssistant);
      expect(palette.bubbleUser).toBe(tokens.bubbleUser);
      expect(palette.tabBackground).toBe(tokens.tabBackground);
      expect(palette.code.background).toBe(scheme === 'light' ? tokens.surfaceAlt : tokens.background);
      expect(palette.code.border).toBe(tokens.border);
      expect(palette.code.syntax).toEqual(Colors[scheme].code.syntax);
    }
  });

  it.each(ACCENT_COLORS.filter((accent) => accent !== 'green'))('tints the neutral surfaces for %s', (accent) => {
    for (const scheme of ['light', 'dark'] as const) {
      const palette = getColors(scheme, accent);
      expect(palette.background).not.toBe(Colors[scheme].background);
      expect(palette.surfaceAlt).not.toBe(Colors[scheme].surfaceAlt);
      expect(palette.border).not.toBe(Colors[scheme].border);
    }
  });

  it.each(ACCENT_COLORS)('keeps text readable across the %s palettes', (accent) => {
    for (const scheme of ['light', 'dark'] as const) {
      const palette = getColors(scheme, accent);
      expect(contrast(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.surfaceAlt)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.onBubbleUser, palette.bubbleUser)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.onTint, palette.tint)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.onDanger, palette.danger)).toBeGreaterThanOrEqual(4.5);
      for (const surface of [palette.background, palette.surface, palette.surfaceAlt]) {
        for (const foreground of [palette.muted, palette.tint, palette.success, palette.warning, palette.danger]) expect(contrast(foreground, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(getUiVariables(scheme, accent)).toEqual(Object.fromEntries(Object.entries(tokens.aliases).map(([alias, role]) => ['--color-' + alias, palette[role as keyof typeof palette]])));
    }
  });
});
