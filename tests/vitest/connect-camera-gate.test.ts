import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };

describe('Cloud Link camera permission gate', () => {
  it.each([
    ['granted', true, true],
    ['requestable denial', false, true],
    ['blocked denial', false, false],
  ] as const)('requests permission on native entry and handles %s', async (_name, granted, canAskAgain) => {
    const runtime = hookRuntime();
    const permission = { status: granted ? 'granted' : 'denied', granted, canAskAgain };
    const requestPermission = vi.fn(async () => permission);
    const useCameraPermissions = vi.fn(({ request }: { request: boolean }) => {
      const [result, setResult] = runtime.react.useState<typeof permission | null>(null);
      runtime.react.useEffect(() => {
        if (request) void requestPermission().then(setResult);
      }, [request]);
      return [result, requestPermission];
    });
    const onCancel = vi.fn();
    const { ConnectCameraGate } = await loadTs('components/settings/connect-camera-gate.tsx', {
      react: runtime.react,
      './sections/setting-rows': { SettingButton: 'Button' },
    'react/jsx-runtime': { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), Fragment: 'Fragment' },
      'expo-camera': { useCameraPermissions },
      'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
      'react-native': { Platform: { OS: 'android' }, StyleSheet: { create: (styles: unknown) => styles }, View: 'View' },
      'react-native-paper': { ActivityIndicator: 'ActivityIndicator' },
    });

    runtime.mount(ConnectCameraGate, { onCancel, children: 'pairing-and-subscription' });
    await runtime.settle();

    expect(useCameraPermissions).toHaveBeenCalledWith({ request: true });
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledTimes(granted ? 0 : 1);
    expect(runtime.value.type).toBe(granted ? 'Fragment' : 'View');
  });

  it('passes through web without requesting camera permission', async () => {
    const runtime = hookRuntime();
    const useCameraPermissions = vi.fn(() => [null, vi.fn()]);
    const { ConnectCameraGate } = await loadTs('components/settings/connect-camera-gate.tsx', {
      react: runtime.react,
      './sections/setting-rows': { SettingButton: 'Button' },
    'react/jsx-runtime': { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), Fragment: 'Fragment' },
      'expo-camera': { useCameraPermissions },
      'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
      'react-native': { Platform: { OS: 'web' }, StyleSheet: { create: (styles: unknown) => styles }, View: 'View' },
      'react-native-paper': { ActivityIndicator: 'ActivityIndicator' },
    });

    runtime.mount(ConnectCameraGate, { onCancel: vi.fn(), children: 'pairing-and-subscription' });

    expect(useCameraPermissions).toHaveBeenCalledWith({ request: false });
    expect((runtime.value as Element).type).toBe('Fragment');
  });
});
