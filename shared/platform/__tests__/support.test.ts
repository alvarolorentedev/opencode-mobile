import { describe, expect, it } from 'vitest';

import { loadTs } from '../../../tests/helpers/runtime.mjs';

async function loadSupport(platform: string, foss: boolean) {
  return loadTs('shared/platform/support.ts', {
    'expo-constants': { __esModule: true, default: { expoConfig: { extra: { foss } } } },
    'react-native': { Platform: { OS: platform } },
  });
}

describe('support store rating availability', () => {
  it.each([
    ['android', false, true],
    ['android', true, false],
    ['ios', false, false],
    ['web', false, false],
  ] as const)('%s (foss=%s) -> %s', async (platform, foss, expected) => {
    const { hasPlayStoreRating } = await loadSupport(platform, foss);
    expect(await hasPlayStoreRating()).toBe(expected);
  });

  it.each([
    ['android', false, true],
    ['android', true, false],
    ['ios', false, true],
    ['web', false, false],
  ] as const)('canRateApp %s (foss=%s) -> %s', async (platform, foss, expected) => {
    const { canRateApp } = await loadSupport(platform, foss);
    expect(await canRateApp()).toBe(expected);
  });
});
