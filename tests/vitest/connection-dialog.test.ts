import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[], testID: string): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, testID)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.props?.testID === testID || root.type === testID) return root;
  return find(root.props?.children, testID);
}
async function form(platform = 'web', onSubmit = vi.fn(), foss = false) {
  const runtime = hookRuntime();
  const probe = vi.fn(async () => ({ status: 'detected', contract: 'v2' }));
  const pair = vi.fn(async () => ({ serverUrl: 'http://192.168.1.10:49374', username: '', password: 'session-token', directory: '' }));
  const { ConnectionProfileDialog } = await loadTs('components/settings/connection-profile-dialog.tsx', {
    react: runtime.react,
    'expo-constants': { expoConfig: { extra: { foss } } },
    'react/jsx-runtime': { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }), Fragment: 'Fragment' },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { Keyboard: { dismiss: () => {} }, Platform: { OS: platform }, StyleSheet: { create: (styles: unknown) => styles }, View: 'View', Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', ScrollView: 'ScrollView' },
    'react-native-paper': { Appbar: { Header: 'Header', BackAction: 'BackAction', Content: 'Content' }, Button: 'Button', HelperText: 'HelperText', Text: 'Text', TextInput: { Icon: 'Icon' } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/components/settings/connect-camera-gate': { ConnectCameraGate: 'Gate' },
    '@/components/settings/connect-scanner': { ConnectScanner: 'Scanner' },
    '@/components/ui/text-input': { TextInput: 'Input' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'light' },
    '@/lib/opencode/client': { isValidServerUrl: () => true },
    '@/lib/opencode/client/url': { getServerHostname: () => '192.168.1.10' },
    '@/lib/opencode/pairing': { LocalPairingError: class extends Error {} },
    '@/providers/opencode-contexts': { useConnection: () => ({ connectionProfiles: { probe, pair } }) },
  }, { Error });
  const onDismiss = vi.fn();
  const onBusyChange = vi.fn();
  runtime.mount(ConnectionProfileDialog, { title: 'Add connection', submitLabel: 'Save', onSubmit, onDismiss, onBusyChange });
  const element = (id: string) => { const value = find(runtime.value, id); if (!value) throw new Error(`Missing ${id}`); return value; };
  const change = (id: string, value: string) => { element(id).props.onChangeText(value); runtime.flush(); };
  const press = async (id: string) => { element(id).props.onPress(); await runtime.settle(); };
  return { runtime, probe, pair, onSubmit, onDismiss, onBusyChange, element, change, press };
}

describe('manual connection form', () => {
  it('shows V2 details without a username and preserves values when changing the address', async () => {
    const view = await form();
    view.change('connection-profile-url-input', 'http://192.168.1.10:49374');
    await view.press('connection-profile-continue');
    expect(find(view.runtime.value, 'connection-profile-username-input')).toBeUndefined();
    expect(view.element('connection-profile-name-input').props.placeholder).toBe('192.168.1.10');
    view.change('connection-profile-name-input', 'Office');
    view.change('connection-profile-password-input', 'secret');
    await view.press('connection-profile-change');
    expect(view.element('connection-profile-url-input').props.value).toBe('http://192.168.1.10:49374');
    await view.press('connection-profile-continue');
    expect(view.element('connection-profile-name-input').props.value).toBe('Office');
    expect(view.element('connection-profile-password-input').props.value).toBe('secret');
  });
  it('preserves uncertainty and allows V1 custom credentials', async () => {
    const view = await form();
    view.probe.mockResolvedValue({ status: 'authentication-required' } as any);
    view.change('connection-profile-url-input', 'http://example.test');
    await view.press('connection-profile-continue');
    expect(view.element('connection-profile-detection').props.children).toBe('settings:connection.setup.identify');
    expect(find(view.runtime.value, 'connection-profile-username-input')).toBeUndefined();
    await view.press('connection-profile-custom-username');
    view.change('connection-profile-username-input', 'alice');
    view.change('connection-profile-password-input', 'secret');
    view.probe.mockResolvedValue({ status: 'detected', contract: 'v1' });
    await view.press('connection-profile-save-confirm');
    expect(view.onSubmit).toHaveBeenCalledWith({ name: '', serverUrl: 'http://example.test', username: 'alice', password: 'secret' });
  });
  it('ignores a probe completed after Back and guards duplicate Continue', async () => {
    const view = await form();
    const gate = deferred();
    view.probe.mockReturnValue(gate.promise);
    view.change('connection-profile-url-input', 'http://example.test');
    view.element('connection-profile-continue').props.onPress();
    view.element('connection-profile-continue').props.onPress();
    view.runtime.flush();
    expect(view.probe).toHaveBeenCalledOnce();
    expect(view.onBusyChange).toHaveBeenLastCalledWith(true);
    await view.press('BackAction');
    expect(view.onDismiss).toHaveBeenCalledOnce();
    expect(view.onBusyChange).toHaveBeenLastCalledWith(false);
    gate.resolve({ status: 'detected', contract: 'v2' });
    await view.runtime.settle();
    expect(find(view.runtime.value, 'connection-profile-name-input')).toBeUndefined();
  });
  it('auto-connects after native scanning and retries save with the redeemed token', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Secure storage unavailable')).mockResolvedValue(undefined);
    const view = await form('android', onSubmit);
    await view.press('connection-local-scan');
    expect(view.element('Gate')).toBeDefined();
    view.element('Scanner').props.onScan('one-use-code');
    await view.runtime.settle();
    expect(view.pair).toHaveBeenCalledOnce();
    expect(view.element('connection-profile-password-input').props.value).toBe('session-token');
    expect(view.element('connection-profile-error').props.children).toBe('Secure storage unavailable');
    await view.press('connection-profile-save-confirm');
    expect(view.pair).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ password: 'session-token', name: '' });
  });
  it('keeps the web camera action hidden', async () => {
    const view = await form();
    expect(find(view.runtime.value, 'connection-local-scan')).toBeUndefined();
  });
  it('keeps scanning hidden in native FOSS builds without a camera module', async () => {
    const view = await form('android', vi.fn(), true);
    expect(find(view.runtime.value, 'connection-local-scan')).toBeUndefined();
  });
});
