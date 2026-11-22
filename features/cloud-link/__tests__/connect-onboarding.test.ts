// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConnectOnboarding } from '@/features/cloud-link/ui/connect-onboarding';
import { ConnectPairing } from '@/features/cloud-link/ui/connect-pairing';
import PairScreen from '@/features/cloud-link/ui/pair-screen';
import type { WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import type { ConnectSetup } from '@/shared/contracts/cloud-link-setup';
import { connectionViewProbe } from '../../../tests/helpers/connection-view-probe';
import { settleReact } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';

const route = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  router: { setParams: vi.fn(), replace: vi.fn(), push: vi.fn() },
}));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'android' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo-router', () => ({
  useIsFocused: () => true, usePathname: () => '/pair',
  useLocalSearchParams: () => route.params, useRouter: () => route.router,
}));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/shared/platform/camera/connect-camera-gate', () => ({ ConnectCameraGate: 'CameraGate' }));
vi.mock('@/shared/platform/camera/connect-scanner', () => ({ ConnectScanner: 'Scanner' }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[], type: unknown): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, type)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.type === type || root.props?.testID === type) return root;
  return find(root.props?.children, type);
}

function pairing(guided = true, entitled = false) {
  const onConnected = vi.fn();
  const setup = { initialization: 'ready', phase: 'idle', busy: false, entitled, cancelPairing: vi.fn(async () => true), pairLink: vi.fn(), dismissError: vi.fn() } as unknown as ConnectSetup;
  const props = { setup, guided, onConnected, onClose: vi.fn(), onManage: vi.fn() };
  const runtime = renderHook(ConnectPairing, props, connectionViewProbe({} as WorkspaceRegistry['connectionControls']));
  const step = () => find(runtime.result.current, ConnectOnboarding)?.props.step;
  const next = () => act(() => find(runtime.result.current, ConnectOnboarding)!.props.onNext());
  const update = (changes: Partial<ConnectSetup>) => runtime.rerender({ ...props, setup: Object.assign(setup, changes) });
  return { runtime, setup, step, next, update, onConnected };
}

describe('Cloud Link guided setup', () => {
  it('delays camera permission until explicit scan and returns to the illustrated step after denial', async () => {
    const view = pairing();
    expect(view.step()).toBe(1);
    view.next(); expect(view.step()).toBe(2);
    view.next(); expect(view.step()).toBe(3);
    expect(find(view.runtime.result.current, 'CameraGate')).toBeUndefined();
    view.update({ phase: 'finalizing', busy: true, entitled: true });
    expect(view.step()).toBe(3);
    view.update({ phase: 'idle', busy: false, error: 'Store finalization failed' });
    expect(view.step()).toBe(3);
    view.update({ error: undefined });
    expect(view.step()).toBe(4);
    expect(view.onConnected).not.toHaveBeenCalled();
    act(() => find(view.runtime.result.current, ConnectOnboarding)!.props.onScan());
    const gate = find(view.runtime.result.current, 'CameraGate');
    expect(gate).toBeDefined();
    act(() => gate!.props.onCancel());
    expect(view.step()).toBe(4);
    expect(find(view.runtime.result.current, 'CameraGate')).toBeUndefined();
  });

  it('keeps canceled and pending purchases on subscription and returns expired access there', async () => {
    const view = pairing(); view.next(); view.next();
    view.update({ phase: 'pending', notice: 'Pending store approval' });
    expect(view.step()).toBe(3);
    view.update({ phase: 'idle', notice: 'Canceled' });
    expect(view.step()).toBe(3);
    view.update({ entitled: true, notice: undefined });
    expect(view.step()).toBe(4);
    view.update({ entitled: false });
    expect(view.step()).toBe(3);
  });

  it('opens the illustrated pairing step for subscribers and preserves direct-link continuation', async () => {
    const subscriber = pairing(true, true);
    expect(subscriber.step()).toBe(4);
    expect(find(subscriber.runtime.result.current, 'CameraGate')).toBeUndefined();
    const linked = pairing(false);
    expect(linked.step()).toBeUndefined();
    expect(find(linked.runtime.result.current, 'connect-subscription-sheet')!.props.visible).toBe(true);
    expect(find(linked.runtime.result.current, 'CameraGate')).toBeUndefined();
    linked.update({ phase: 'paired', entitled: true });
    expect(linked.onConnected).toHaveBeenCalledOnce();
  });
});


it('strips an incoming QR immediately and pairs once after store recovery becomes ready', async () => {
  route.params = { v: '1', cp: 'https://api.opencodecloud.link', id: 'pending', t: 'temporary-proof' };
  const incoming = { ...route.params };
  const pairLink = vi.fn(async () => true);
  const setup = { enabled: true, initialization: 'loading', busy: true, pairLink, cancelPairing: vi.fn(async () => true) } as unknown as ConnectSetup;
  const setParams = route.router.setParams.mockImplementation((patch) => { route.params = { ...route.params, ...patch }; });
  const controls = { connectSetup: setup } as WorkspaceRegistry['connectionControls'];
  const runtime = renderHook(PairScreen, {}, connectionViewProbe(controls, true));
  await settleReact();
  expect(setParams).toHaveBeenCalledOnce();
  expect(route.params.t).toBeUndefined();
  expect(pairLink).not.toHaveBeenCalled();
  setup.initialization = 'ready'; runtime.rerender({}); await settleReact();
  expect(pairLink).not.toHaveBeenCalled();
  setup.busy = false; runtime.rerender({}); await settleReact();
  expect(pairLink).toHaveBeenCalledExactlyOnceWith(incoming);
  runtime.rerender({}); await settleReact();
  expect(pairLink).toHaveBeenCalledOnce();
  setup.initialization = 'loading'; setup.busy = true;
  route.params = { ...incoming, id: 'cancelled' }; runtime.rerender({}); await settleReact();
  await act(async () => { await runtime.result.current?.props.setup.cancelPairing(); });
  setup.initialization = 'ready'; setup.busy = false;
  runtime.rerender({}); await settleReact();
  expect(pairLink).toHaveBeenCalledOnce();
  runtime.unmount();
});
