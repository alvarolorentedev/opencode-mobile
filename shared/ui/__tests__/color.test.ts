import { describe, expect, it } from 'vitest';

import { withAlpha } from '@/shared/ui/theme/color';

describe('withAlpha', () => {
  it('appends or replaces a hex alpha channel', () => {
    expect(withAlpha('#123456', 24 / 255)).toBe('#12345618');
    expect(withAlpha('#12345680', 0)).toBe('#12345600');
  });

  it('leaves non-hex colors untouched', () => {
    expect(withAlpha('rgba(0, 0, 0, 0.5)', 0.2)).toBe('rgba(0, 0, 0, 0.5)');
  });
});
