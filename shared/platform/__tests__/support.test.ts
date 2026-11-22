import { describe, expect, it, vi } from 'vitest';

import { canRateApp, hasPlayStoreRating } from '@/shared/platform/support';

const { inputs } = vi.hoisted(() => ({ inputs: { platform: 'android', foss: false } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { get foss() { return inputs.foss; } } } } }));
vi.mock('react-native', () => ({ Platform: { get OS() { return inputs.platform; } } }));

describe('support store rating availability', () => {
  it.each([
    ['android', false, true],
    ['android', true, false],
    ['ios', false, false],
    ['web', false, false],
  ] as const)('%s (foss=%s) -> %s', async (platform, foss, expected) => {
    Object.assign(inputs, { platform, foss });
    expect(await hasPlayStoreRating()).toBe(expected);
  });

  it.each([
    ['android', false, true],
    ['android', true, false],
    ['ios', false, true],
    ['web', false, false],
  ] as const)('canRateApp %s (foss=%s) -> %s', async (platform, foss, expected) => {
    Object.assign(inputs, { platform, foss });
    expect(await canRateApp()).toBe(expected);
  });
});
