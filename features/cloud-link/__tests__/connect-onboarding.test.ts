import { uiImports } from '../../../tests/helpers/ui.mjs';
import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[], type: string): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, type)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.type === type || root.props?.testID === type) return root;
  return find(root.props?.children, type);
}

async function pairing(guided = true, entitled = false) {
  const runtime = hookRuntime();
  const onConnected = vi.fn();
  const setup = { initialization: 'ready', phase: 'idle', busy: false, entitled, cancelPairing: vi.fn(async () => true), pairLink: vi.fn(), dismissError: vi.fn() };
  const { ConnectPairing } = await loadTs('features/cloud-link/ui/connect-pairing.tsx', {
    ...uiImports,
    "@/shared/contracts/cloud-link": { CONNECT_LEARN_MORE_URL: "https://opencodecloud.link/" },
    "@/features/connections/ui/connection-setup-form": { ConnectionSetupForm: "ConnectionSetupForm" },
    react: runtime.react,
    'react/jsx-runtime': { jsx: (type: unknown, props: object) => ({ type, props }), jsxs: (type: unknown, props: object) => ({ type, props }) },
    'expo-router': { useIsFocused: () => true },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' }, StyleSheet: { create: (styles: object) => styles }, View: 'View', KeyboardAvoidingView: 'View' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "./sections/setting-rows": { Button: 'Button' },
    "@/shared/ui/theme/theme": { Colors: { light: {} } },
    "@/shared/ui/theme/use-color-scheme": { useColorScheme: () => 'light' },
    "@/shared/ui/theme/use-palette": { usePalette: () => ({}) },
    "@/shared/ui/hooks/use-dismiss-on-back": { useDismissOnBack: vi.fn() },
    "@/runtime/presentation/use-update-blocker": { useUpdateBlocker: vi.fn() },
    "@/shared/platform/camera/connect-camera-gate": { ConnectCameraGate: 'CameraGate' },
    "@/shared/platform/camera/connect-scanner": { ConnectScanner: 'Scanner' },
    "@/features/cloud-link/ui/connect-subscription": { ConnectSubscription: 'Subscription' },
    "@/features/cloud-link/ui/connect-onboarding": { ConnectOnboarding: 'Onboarding' },
    "@/shared/ui/overlay-sheet": { OverlaySheet: 'Overlay' }
  });
  runtime.mount(ConnectPairing, { setup, guided, onConnected, onClose: vi.fn(), onManage: vi.fn() });
  const step = () => find(runtime.value, 'Onboarding')?.props.step;
  const next = () => { find(runtime.value, 'Onboarding')!.props.onNext(); runtime.flush(); };
  const update = (changes: object) => { Object.assign(setup, changes); runtime.update({ setup }); };
  return { runtime, setup, step, next, update, onConnected };
}

describe('Cloud Link guided setup', () => {
  it('delays camera permission until explicit scan and returns to the illustrated step after denial', async () => {
    const view = await pairing();
    expect(view.step()).toBe(1);
    view.next(); expect(view.step()).toBe(2);
    view.next(); expect(view.step()).toBe(3);
    expect(find(view.runtime.value, 'CameraGate')).toBeUndefined();
    view.update({ phase: 'finalizing', busy: true, entitled: true });
    expect(view.step()).toBe(3);
    view.update({ phase: 'idle', busy: false, error: 'Store finalization failed' });
    expect(view.step()).toBe(3);
    view.update({ error: undefined });
    expect(view.step()).toBe(4);
    expect(view.onConnected).not.toHaveBeenCalled();
    find(view.runtime.value, 'Onboarding')!.props.onScan(); view.runtime.flush();
    const gate = find(view.runtime.value, 'CameraGate');
    expect(gate).toBeDefined();
    gate!.props.onCancel(); view.runtime.flush();
    expect(view.step()).toBe(4);
    expect(find(view.runtime.value, 'CameraGate')).toBeUndefined();
  });

  it('keeps canceled and pending purchases on subscription and returns expired access there', async () => {
    const view = await pairing(); view.next(); view.next();
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
    const subscriber = await pairing(true, true);
    expect(subscriber.step()).toBe(4);
    expect(find(subscriber.runtime.value, 'CameraGate')).toBeUndefined();
    const linked = await pairing(false);
    expect(linked.step()).toBeUndefined();
    expect(find(linked.runtime.value, 'connect-subscription-sheet')!.props.visible).toBe(true);
    expect(find(linked.runtime.value, 'CameraGate')).toBeUndefined();
    linked.update({ phase: 'paired', entitled: true });
    expect(linked.onConnected).toHaveBeenCalledOnce();
  });
});


it('strips an incoming QR immediately and pairs once after store recovery becomes ready', async () => {
  const runtime = hookRuntime();
  let params: Record<string, string | undefined> = { v: '1', cp: 'https://api.opencodecloud.link', id: 'pending', t: 'temporary-proof' };
  const incoming = { ...params };
  const pairLink = vi.fn(async () => true);
  const setup = { enabled: true, initialization: 'loading', busy: true, pairLink };
  const setParams = vi.fn((next: typeof params) => { params = { ...params, ...next }; });
  const router = { setParams, replace: vi.fn(), push: vi.fn() };
  const { default: PairScreen } = await loadTs('features/cloud-link/ui/pair-screen.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': { jsx: (type: unknown, props: object) => ({ type, props }), jsxs: (type: unknown, props: object) => ({ type, props }) },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => router },
    'react-native': { KeyboardAvoidingView: 'View', ScrollView: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'View' },
    '@/features/cloud-link/ui/connect-panel': { ConnectManagementPanel: 'Management' },
    '@/features/cloud-link/ui/connect-pairing': { ConnectEntry: 'Entry' },
    '@/features/connections/context': { useConnection: () => ({ connectSetup: setup }) },
    '@/runtime/workspace': { useBootState: () => ({ isHydrated: true, onboardingCompleted: true, onboardingActive: false }) },
  });
  runtime.mount(PairScreen, {});
  await runtime.settle();
  expect(setParams).toHaveBeenCalledOnce();
  expect(params.t).toBeUndefined();
  expect(pairLink).not.toHaveBeenCalled();
  setup.initialization = 'ready'; runtime.update({}); await runtime.settle();
  expect(pairLink).not.toHaveBeenCalled();
  setup.busy = false; runtime.update({}); await runtime.settle();
  expect(pairLink).toHaveBeenCalledExactlyOnceWith(incoming);
  runtime.update({}); await runtime.settle();
  expect(pairLink).toHaveBeenCalledOnce();
  runtime.unmount();
});
