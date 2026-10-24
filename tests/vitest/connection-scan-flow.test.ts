import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[] | null, testID: string): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, testID)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.props?.testID === testID || root.type === testID) return root;
  return find(root.props?.children, testID);
}

class LocalPairingError extends Error {
  constructor(public reason: string) { super(reason); }
}

async function flow(platform = 'android', foss = false, onSubmit = vi.fn()) {
  const runtime = hookRuntime();
  const pair = vi.fn(async () => ({ serverUrl: 'http://192.168.1.10:49374', username: '', password: 'session-token', directory: '' }));
  const { ConnectionScanFlow } = await loadTs('components/settings/connection-scan-flow.tsx', {
    react: runtime.react,
    'expo-constants': { expoConfig: { extra: { foss } } },
    'react/jsx-runtime': { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }), Fragment: 'Fragment' },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { Platform: { OS: platform }, StyleSheet: { create: (styles: unknown) => styles }, View: 'View', Modal: 'Modal', ScrollView: 'ScrollView' },
    'react-native-paper': { Appbar: { Header: 'Header', BackAction: 'BackAction', Content: 'Content' }, Button: 'Button', HelperText: 'HelperText', Text: 'Text', ActivityIndicator: 'ActivityIndicator' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/components/settings/connect-camera-gate': { ConnectCameraGate: 'Gate' },
    '@/components/settings/connect-scanner': { ConnectScanner: 'Scanner' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/hooks/use-update-blocker': { useUpdateBlocker: () => {} },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'light' },
    '@/hooks/use-palette': { usePalette: () => ({}) },
    '@/lib/opencode/pairing': { LocalPairingError },
    '@/providers/opencode-contexts': { useConnection: () => ({ connectionProfiles: { pair } }) },
  }, { Error });
  const onDismiss = vi.fn();
  const onBusyChange = vi.fn();
  runtime.mount(ConnectionScanFlow, { onSubmit, onDismiss, onBusyChange });
  const element = (id: string) => { const value = find(runtime.value, id); if (!value) throw new Error(`Missing ${id}`); return value; };
  const press = async (id: string) => { element(id).props.onPress(); await runtime.settle(); };
  return { runtime, pair, onSubmit, onDismiss, onBusyChange, element, press };
}

describe('local QR scan flow', () => {
  it('pairs a scanned code and saves with the redeemed credentials', async () => {
    const view = await flow();
    expect(view.element('Gate')).toBeDefined();
    view.element('Scanner').props.onScan('one-use-code');
    await view.runtime.settle();
    expect(view.pair).toHaveBeenCalledOnce();
    expect(view.onSubmit).toHaveBeenCalledWith({ name: '', serverUrl: 'http://192.168.1.10:49374', username: '', password: 'session-token', headers: {} });
  });

  it('retains the redeemed credential and retries save without pairing again', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Secure storage unavailable')).mockResolvedValue(undefined);
    const view = await flow('android', false, onSubmit);
    view.element('Scanner').props.onScan('one-use-code');
    await view.runtime.settle();
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
    view.element('Scanner').props.onScan('stale-code');
    await view.runtime.settle();
    expect(view.element('connection-scan-error').props.children).toBe('settings:connection.setup.pairingErrors.expired');
    expect(find(view.runtime.value, 'connection-scan-retry')).toBeUndefined();
    expect(view.element('connection-scan-again')).toBeDefined();
  });

  it('returns to the chooser on Back without exposing the manual address form', async () => {
    const view = await flow();
    await view.press('BackAction');
    expect(view.onDismiss).toHaveBeenCalledOnce();
    expect(find(view.runtime.value, 'connection-profile-url-input')).toBeUndefined();
  });

  it('renders nothing on web or FOSS builds without a camera module', async () => {
    const web = await flow('web');
    expect(find(web.runtime.value, 'Gate')).toBeUndefined();
    expect(find(web.runtime.value, 'Scanner')).toBeUndefined();
    const foss = await flow('android', true);
    expect(find(foss.runtime.value, 'Gate')).toBeUndefined();
  });
});
