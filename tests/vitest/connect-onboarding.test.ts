import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

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
  const { ConnectPairing } = await loadTs('components/settings/connect-pairing.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: (type: unknown, props: object) => ({ type, props }), jsxs: (type: unknown, props: object) => ({ type, props }) },
    'expo-router': { useIsFocused: () => true },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' }, StyleSheet: { create: (styles: object) => styles }, View: 'View', KeyboardAvoidingView: 'View' },
    'react-native-paper': { ActivityIndicator: 'Spinner', Appbar: { Header: 'Header', BackAction: 'Back', Content: 'Title', Action: 'Action' }, Button: 'Button', HelperText: 'HelperText', Text: 'Text' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/constants/theme': { Colors: { light: {} } },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'light' },
    '@/hooks/use-dismiss-on-back': { useDismissOnBack: vi.fn() },
    '@/hooks/use-update-blocker': { useUpdateBlocker: vi.fn() },
    '@/lib/connect': {},
    '@/components/settings/connect-camera-gate': { ConnectCameraGate: 'CameraGate' },
    '@/components/settings/connect-scanner': { ConnectScanner: 'Scanner' },
    '@/components/settings/connect-subscription': { ConnectSubscription: 'Subscription' },
    '@/components/settings/connect-onboarding': { ConnectOnboarding: 'Onboarding' },
    '@/components/settings/connection-setup-form': {},
    '@/components/ui/overlay-sheet': { OverlaySheet: 'Overlay' },
    '@/components/ui/text-input': {},
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
