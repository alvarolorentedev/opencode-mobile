import { describe, expect, it } from 'vitest';

import { clampImageScale, clampImageTranslation, DOUBLE_TAP_IMAGE_SCALE, MAX_IMAGE_SCALE, MIN_IMAGE_SCALE, toggleImageScale } from '@/features/sharing/model/image-transform';

describe('attachment image transform', () => {
  it('clamps the zoom scale to the supported range', () => {
    expect(clampImageScale(0.4)).toBe(MIN_IMAGE_SCALE);
    expect(clampImageScale(2.25)).toBe(2.25);
    expect(clampImageScale(9)).toBe(MAX_IMAGE_SCALE);
    expect(clampImageScale(Number.NaN)).toBe(MIN_IMAGE_SCALE);
  });

  it('keeps panning inside the scaled image bounds', () => {
    expect(clampImageTranslation(40, 1, 400)).toBe(0);
    expect(clampImageTranslation(40, 2, 400)).toBe(40);
    expect(clampImageTranslation(400, 2, 400)).toBe(200);
    expect(clampImageTranslation(-400, 2, 400)).toBe(-200);
  });

  it('toggles between the fitted and zoomed scales', () => {
    expect(toggleImageScale(MIN_IMAGE_SCALE)).toBe(DOUBLE_TAP_IMAGE_SCALE);
    expect(toggleImageScale(DOUBLE_TAP_IMAGE_SCALE)).toBe(MIN_IMAGE_SCALE);
  });
});
