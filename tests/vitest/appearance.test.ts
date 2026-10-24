import { describe, expect, it, vi } from 'vitest';

import {
  ACCENT_COLORS,
  ACCENT_PALETTES,
  Colors,
  getColors,
} from '@/constants/theme';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: (value: Record<string, unknown>) => value.web ?? value.default },
}));

describe('accent palette presets', () => {
  it('exposes the six expected accents in a stable order', () => {
    expect(ACCENT_COLORS).toEqual(['green', 'blue', 'red', 'purple', 'pink', 'gray']);
  });

  it('keeps green identical to the original palette', () => {
    expect(getColors('light', 'green')).toEqual(Colors.light);
    expect(getColors('dark', 'green')).toEqual(Colors.dark);
  });

  it.each(ACCENT_COLORS)('defines both schemes for %s', (accent) => {
    for (const scheme of ['light', 'dark'] as const) {
      const palette = getColors(scheme, accent);
      const tokens = ACCENT_PALETTES[accent][scheme];
      expect(palette.tint).toBe(tokens.tint);
      expect(palette.accent).toBe(tokens.accent);
      expect(palette.bubbleUser).toBe(tokens.bubbleUser);
      expect(palette.onBubbleUser).toBe(tokens.onBubbleUser);
      expect(palette.tabIconSelected).toBe(tokens.tint);
      // Neutral surfaces intentionally stay shared across accents.
      expect(palette.background).toBe(Colors[scheme].background);
      expect(palette.border).toBe(Colors[scheme].border);
    }
  });
});
