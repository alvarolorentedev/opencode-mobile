// @vitest-environment happy-dom

import { act, Fragment, useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConnectCameraGate } from '@/shared/platform/camera/connect-camera-gate';
import { renderHook } from '../../../tests/helpers/render-hook';

const native = vi.hoisted(() => ({ platform: 'android', useCameraPermissions: vi.fn() }));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform(native));
vi.mock('uniwind', () => ({ withUniwind: (component: unknown) => component }));
vi.mock('@rn-primitives/slot', () => ({ Slot: 'Slot' }));
vi.mock('expo-camera', () => ({ useCameraPermissions: native.useCameraPermissions }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('Cloud Link camera permission gate', () => {
  it.each([
    ['granted', true, true],
    ['requestable denial', false, true],
    ['blocked denial', false, false],
  ] as const)('requests permission on native entry and handles %s', async (_name, granted, canAskAgain) => {
    const permission = { status: granted ? 'granted' : 'denied', granted, canAskAgain };
    const requestPermission = vi.fn(async () => permission);
    native.platform = 'android';
    const useCameraPermissions = native.useCameraPermissions.mockReset().mockImplementation(({ request }: { request: boolean }) => {
      const [result, setResult] = useState<typeof permission | null>(null);
      useEffect(() => {
        if (request) void requestPermission().then(setResult);
      }, [request]);
      return [result, requestPermission];
    });
    const onCancel = vi.fn();
    const runtime = renderHook(ConnectCameraGate, { onCancel, children: 'pairing-and-subscription' });
    await act(async () => {});

    expect(useCameraPermissions).toHaveBeenCalledWith({ request: true });
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledTimes(granted ? 0 : 1);
    expect(runtime.result.current.type).toBe(granted ? Fragment : 'View');
  });

  it('passes through web without requesting camera permission', async () => {
    native.platform = 'web';
    const useCameraPermissions = native.useCameraPermissions.mockReset().mockReturnValue([null, vi.fn()]);
    const runtime = renderHook(ConnectCameraGate, { onCancel: vi.fn(), children: 'pairing-and-subscription' });

    expect(useCameraPermissions).toHaveBeenCalledWith({ request: false });
    expect(runtime.result.current.type).toBe(Fragment);
  });
});
