// @vitest-environment happy-dom

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../tests/helpers/native-primitives';
import { ConnectionScanFlow } from '@/features/connections/ui/connection-scan-flow';
import type { WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import { LocalPairingError } from '@/shared/contracts/pairing-error';
import { Button } from '@/shared/ui/button';
import { connectionViewProbe } from '../../../tests/helpers/connection-view-probe';
import { renderHook } from '../../../tests/helpers/render-hook';

const native = vi.hoisted(() => ({ platform: 'android', foss: false, launchImageLibraryAsync: vi.fn(), scanFromURLAsync: vi.fn() }));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform(native));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { get foss() { return native.foss; } } } } }));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('react-i18next', async (original) => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('@/shared/platform/camera/connect-camera-gate', () => ({ ConnectCameraGate: 'Gate' }));
vi.mock('@/shared/platform/camera/connect-scanner', () => ({ ConnectScanner: 'Scanner' }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: native.launchImageLibraryAsync }));
vi.mock('expo-camera', () => ({ scanFromURLAsync: native.scanFromURLAsync }));

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[] | null, testID: string | typeof Button): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, testID)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.props?.testID === testID || root.type === testID) return root;
  return find(root.props?.children, testID);
}

function flow(platform = 'android', foss = false, onSubmit = vi.fn()) {
  Object.assign(native, { platform, foss });
  const pair = vi.fn(async () => ({ serverUrl: 'http://192.168.1.10:49374', username: '', password: 'session-token', directory: '' }));
  const onDismiss = vi.fn();
  const onBusyChange = vi.fn();
  const controls = { connectionProfiles: { pair } } as unknown as WorkspaceRegistry['connectionControls'];
  const runtime = renderHook(ConnectionScanFlow, { onSubmit, onDismiss, onBusyChange }, connectionViewProbe(controls));
  const element = (id: string | typeof Button) => {
    const value = find(runtime.result.current, id);
    if (!value) throw new Error(`Missing ${String(id)}`);
    return value;
  };
  const press = async (id: string | typeof Button) => act(async () => { await element(id).props.onPress(); });
  const scan = async (code: string) => act(async () => { element('Scanner').props.onScan(code); });
  return { runtime, pair, onSubmit, onDismiss, onBusyChange, element, press, scan };
}

describe('local QR scan flow', () => {
  beforeEach(() => {
    native.launchImageLibraryAsync.mockReset();
    native.scanFromURLAsync.mockReset();
  });

  it('pairs a scanned code and saves with the redeemed credentials', async () => {
    const view = await flow();
    expect(view.element('Gate')).toBeDefined();
    await view.scan('one-use-code');
    expect(view.pair).toHaveBeenCalledOnce();
    expect(view.onSubmit).toHaveBeenCalledWith({ name: '', serverUrl: 'http://192.168.1.10:49374', username: '', password: 'session-token', headers: {} });
  });

  it('imports a QR image and redeems it through the same pairing path', async () => {
    const view = await flow();
    native.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/qr.png' }] });
    native.scanFromURLAsync.mockResolvedValue([{ data: 'one-use-code' }]);
    await view.press('connection-scan-import');
    expect(native.scanFromURLAsync).toHaveBeenCalledWith('file:///tmp/qr.png', ['qr']);
    expect(view.pair).toHaveBeenCalledWith('one-use-code', expect.anything());
    expect(view.onSubmit).toHaveBeenCalledWith({ name: '', serverUrl: 'http://192.168.1.10:49374', username: '', password: 'session-token', headers: {} });
  });

  it('keeps the camera scanning when the picked image carries no QR code', async () => {
    const view = await flow();
    native.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/blank.png' }] });
    native.scanFromURLAsync.mockResolvedValue([]);
    await view.press('connection-scan-import');
    expect(view.pair).not.toHaveBeenCalled();
    expect(find(view.runtime.result.current, 'connection-scan-error')).toBeUndefined();
    expect(view.element('Scanner').props.enabled).toBe(true);
    expect(find(view.runtime.result.current, 'connection-scan-import')).toBeDefined();
  });

  it('does nothing when the image picker is dismissed', async () => {
    const view = await flow();
    native.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    await view.press('connection-scan-import');
    expect(native.scanFromURLAsync).not.toHaveBeenCalled();
    expect(view.pair).not.toHaveBeenCalled();
    expect(view.element('Scanner').props.enabled).toBe(true);
  });

  it('retains the redeemed credential and retries save without pairing again', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Secure storage unavailable')).mockResolvedValue(undefined);
    const view = await flow('android', false, onSubmit);
    await view.scan('one-use-code');
    expect(view.pair).toHaveBeenCalledOnce();
    expect(view.element('connection-scan-error').props.children).toBe('Secure storage unavailable');
    await view.press('connection-scan-retry');
    expect(view.pair).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ password: 'session-token', name: '' });
  });

  it('maps a pairing failure to its message and only offers a rescan', async () => {
    const view = await flow();
    view.pair.mockRejectedValue(new LocalPairingError('expired'));
    await view.scan('stale-code');
    expect(view.element('connection-scan-error').props.children).toBe('settings:connection.setup.pairingErrors.expired');
    expect(find(view.runtime.result.current, 'connection-scan-retry')).toBeUndefined();
    expect(view.element('connection-scan-again')).toBeDefined();
  });

  it('returns to the chooser on Back without exposing the manual address form', async () => {
    const view = await flow();
    await view.press(Button);
    expect(view.onDismiss).toHaveBeenCalledOnce();
    expect(find(view.runtime.result.current, 'connection-profile-url-input')).toBeUndefined();
  });

  it('renders nothing on web or FOSS builds without a camera module', async () => {
    const web = await flow('web');
    expect(find(web.runtime.result.current, 'Gate')).toBeUndefined();
    expect(find(web.runtime.result.current, 'Scanner')).toBeUndefined();
    const foss = await flow('android', true);
    expect(find(foss.runtime.result.current, 'Gate')).toBeUndefined();
  });
});
