import { describe, expect, it, vi } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

async function loadHaptics(platform: 'android' | 'ios', overrides: Record<string, unknown> = {}) {
  const impactAsync = vi.fn(() => Promise.resolve());
  const performAndroidHapticsAsync = vi.fn(() => Promise.resolve());
  const vibrate = vi.fn();
  const { codeCopyHaptic } = await loadTs('lib/haptics.ts', {
    'expo-haptics': {
      AndroidHaptics: { Confirm: 'confirm' },
      ImpactFeedbackStyle: { Light: 'light' },
      impactAsync,
      performAndroidHapticsAsync,
      ...overrides,
    },
    'react-native': {
      Platform: { OS: platform },
      Vibration: { vibrate },
    },
  }, { __DEV__: false });
  return { codeCopyHaptic, impactAsync, performAndroidHapticsAsync, vibrate };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('code-copy haptics', () => {
  it('prefers the system confirmation effect on Android', async () => {
    const { codeCopyHaptic, impactAsync, performAndroidHapticsAsync } = await loadHaptics('android');

    codeCopyHaptic();
    await settle();

    expect(performAndroidHapticsAsync).toHaveBeenCalledWith('confirm');
    expect(impactAsync).not.toHaveBeenCalled();
  });

  it('falls back to a light impact when the system effect is unavailable', async () => {
    const { codeCopyHaptic, impactAsync, vibrate } = await loadHaptics('android', {
      performAndroidHapticsAsync: vi.fn(() => Promise.reject(new Error('unsupported'))),
    });

    codeCopyHaptic();
    await settle();

    expect(impactAsync).toHaveBeenCalledWith('light');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('falls back to a raw vibration when expo-haptics is unavailable', async () => {
    const { codeCopyHaptic, vibrate } = await loadHaptics('android', {
      impactAsync: vi.fn(() => Promise.reject(new Error('unavailable'))),
      performAndroidHapticsAsync: vi.fn(() => Promise.reject(new Error('unavailable'))),
    });

    codeCopyHaptic();
    await settle();

    expect(vibrate).toHaveBeenCalledWith(20);
  });

  it('uses a light impact on iOS', async () => {
    const { codeCopyHaptic, impactAsync, performAndroidHapticsAsync } = await loadHaptics('ios');

    codeCopyHaptic();
    await settle();

    expect(impactAsync).toHaveBeenCalledWith('light');
    expect(performAndroidHapticsAsync).not.toHaveBeenCalled();
  });
});
