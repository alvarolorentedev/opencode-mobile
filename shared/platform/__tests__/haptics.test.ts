import { describe, expect, it, vi } from 'vitest';

import { copyHaptic } from '@/shared/platform/haptics';

const { notificationAsync } = vi.hoisted(() => ({ notificationAsync: vi.fn(async () => undefined) }));
vi.mock('expo-haptics', () => ({ NotificationFeedbackType: { Success: 'success' }, notificationAsync }));

describe('copy haptics', () => {
  it('uses the success notification for a copy acknowledgement', async () => {
    copyHaptic();
    await Promise.resolve();

    expect(notificationAsync).toHaveBeenCalledWith('success');
    expect(notificationAsync).toHaveBeenCalledTimes(1);
  });
});
