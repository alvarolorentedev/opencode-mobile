import { describe, expect, it, vi } from 'vitest';

import { loadTs } from '../../../tests/helpers/runtime.mjs';

async function loadHaptics() {
  const notificationAsync = vi.fn(() => Promise.resolve());
  const { copyHaptic } = await loadTs('shared/platform/haptics.ts', {
    'expo-haptics': {
      NotificationFeedbackType: { Success: 'success' },
      notificationAsync,
    },
  });
  return { copyHaptic, notificationAsync };
}

describe('copy haptics', () => {
  it('uses the success notification for a copy acknowledgement', async () => {
    const { copyHaptic, notificationAsync } = await loadHaptics();

    copyHaptic();
    await Promise.resolve();

    expect(notificationAsync).toHaveBeenCalledWith('success');
    expect(notificationAsync).toHaveBeenCalledTimes(1);
  });
});
