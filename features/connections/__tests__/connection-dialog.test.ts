import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { uiImports, formImports } from '../../../tests/helpers/ui.mjs';
import { describe, expect, it, vi } from 'vitest';
import { deferred, hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[], testID: string): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, testID)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.props?.testID === testID || root.type === testID) return root;
  return find(root.props?.children, testID);
}
async function form(onSubmit = vi.fn()) {
  const runtime = hookRuntime();
  const probe = vi.fn(async () => ({ status: 'detected', contract: 'v2' }));
  const connectionHeaders = await loadTs(['shared/storage/connection-headers.ts', 'shared/contracts/connection-headers.ts'], {
    ...uiImports,
    'react-hook-form': formImports(runtime.react),
    '@hookform/resolvers/zod': { zodResolver },
    'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} },
    'react-native': { Platform: { OS: 'web' } },
    "@/shared/storage/cloud-link": { getConnectTestSecret: () => '', setConnectTestSecret: () => {} }
  });
  const { isValidServerUrl, normalizeServerUrl } = await loadTs('shared/contracts/server-url.ts', {
    "@/shared/protocol/opencode/client/types": { defaultConnectionSettings: { serverUrl: 'http://localhost:4096' } }
  });
  const connectionOidc = await loadTs('shared/contracts/connection-oidc.ts', {
    '@scure/base': { base64urlnopad: { encode: () => 'key' } },
  });
  const { connectionSchema } = await loadTs('features/connections/model/connection-schema.ts', {
    zod: { z },
    "@/shared/contracts/connection-headers": connectionHeaders,
    "@/shared/contracts/connection-oidc": connectionOidc,
    "@/shared/contracts/server-url": { isValidServerUrl, normalizeServerUrl }
  });
  const signIn = vi.fn(async () => ({ accessToken: 'token', expiresAt: Date.now() + 3600_000, tokenType: 'Bearer', issuer: 'https://login.example.test/realms/main', clientId: 'opencode-mobile' }));
  const { ConnectionProfileDialog } = await loadTs('features/connections/ui/connection-profile-dialog.tsx', {
    ...uiImports,
    'react-hook-form': formImports(runtime.react),
    '@hookform/resolvers/zod': { zodResolver },
    react: runtime.react,
    'react/jsx-runtime': { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }), Fragment: 'Fragment' },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { Keyboard: { dismiss: () => {} }, StyleSheet: { create: (styles: unknown) => styles }, View: 'View', Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', ScrollView: 'ScrollView' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "@/shared/contracts/connection-headers": connectionHeaders,
    "@/shared/contracts/connection-oidc": connectionOidc,
    "@/features/connections/model/connection-schema": { connectionSchema },
    "@/features/connections/ui/connection-oidc-fields": { ConnectionOidcFields: 'OidcFields' },
    "@/shared/ui/settings/setting-rows": { SettingField: 'Input', SettingSwitchRow: 'SwitchRow' },
    "@/shared/ui/theme/theme": { Colors: { light: {} } },
    "@/runtime/presentation/use-update-blocker": { useUpdateBlocker: () => {} },
    "@/shared/ui/theme/use-color-scheme": { useColorScheme: () => 'light' },
    "@/shared/ui/theme/use-palette": { usePalette: () => ({}) },
    "@/shared/contracts/server-url": { isValidServerUrl: () => true, getServerHostname: () => '192.168.1.10' },
    "@/shared/platform/linking": { createURL: (path: string) => `opencodemobile://${path}` },
    "@/shared/platform/tls-trust": { isTlsTrustSupported: () => false, connectionOrigin: () => undefined },
    "@/features/connections/state/use-connection-certificate": { useConnectionCertificate: () => ({ supported: false, busy: false, error: undefined, pick: async () => undefined, clearError: () => {} }) },
    "@/features/connections/context": { useConnection: () => ({ connectionProfiles: { probe, signIn, oidcStatus: async () => 'signed-out' } }) }
  }, { Error });
  const onDismiss = vi.fn();
  const onBusyChange = vi.fn();
  runtime.mount(ConnectionProfileDialog, { title: 'Add connection', submitLabel: 'Save', onSubmit, onDismiss, onBusyChange });
  const element = (id: string) => { const value = find(runtime.value, id); if (!value) throw new Error(`Missing ${id}`); return value; };
  const change = (id: string, value: string) => { element(id).props.onChangeText(value); runtime.flush(); };
  const press = async (id: string) => { element(id).props.onPress(); await runtime.settle(); };
  return { runtime, probe, signIn, onSubmit, onDismiss, onBusyChange, element, change, press };
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
    expect(view.onSubmit).toHaveBeenCalledWith({ name: '', serverUrl: 'http://example.test', username: 'alice', password: 'secret', headers: {} });
  });
  it('collects validated custom headers and hides them by default', async () => {
    const view = await form();
    view.change('connection-profile-url-input', 'http://example.test');
    await view.press('connection-profile-continue');
    expect(find(view.runtime.value, 'connection-profile-header-name-0')).toBeUndefined();
    await view.press('connection-profile-headers-toggle');
    await view.press('connection-profile-header-add');
    view.change('connection-profile-header-name-0', 'CF-Access-Client-Id');
    view.change('connection-profile-header-value-0', 'client-id');
    expect(view.element('connection-profile-header-value-0').props.secureTextEntry).toBe(true);
    await view.press('connection-profile-header-visibility');
    expect(view.element('connection-profile-header-value-0').props.secureTextEntry).toBe(false);
    await view.press('connection-profile-header-add');
    view.change('connection-profile-header-name-1', 'CF-Access-Client-Secret');
    view.change('connection-profile-header-value-1', 'client-secret');
    await view.press('connection-profile-save-confirm');
    expect(view.onSubmit).toHaveBeenCalledWith({
      name: '', serverUrl: 'http://example.test', username: '', password: '',
      headers: { 'CF-Access-Client-Id': 'client-id', 'CF-Access-Client-Secret': 'client-secret' },
    });
  });
  it('collects OpenID Connect settings and only signs in on demand', async () => {
    const view = await form();
    view.change('connection-profile-url-input', 'https://example.test');
    await view.press('connection-profile-continue');
    const fields = () => { const value = find(view.runtime.value, 'OidcFields'); if (!value) throw new Error('Missing OidcFields'); return value; };
    const patch = (value: Record<string, unknown>) => { fields().props.onChange(value); view.runtime.flush(); };
    expect(fields().props.value.enabled).toBe(false);
    expect(find(view.runtime.value, 'connection-profile-password-input')).toBeDefined();
    patch({ enabled: true });
    expect(fields().props.value.enabled).toBe(true);
    expect(find(view.runtime.value, 'connection-profile-password-input')).toBeDefined();
    patch({ issuer: 'https://login.example.test/realms/main' });
    patch({ clientId: 'opencode-mobile' });
    view.change('connection-profile-password-input', 'server-password');
    fields().props.onSignIn();
    await view.runtime.settle();
    expect(view.signIn).toHaveBeenCalledWith({
      serverUrl: 'https://example.test',
      username: '',
      oidc: { issuer: 'https://login.example.test/realms/main', clientId: 'opencode-mobile', scopes: 'openid profile email offline_access', tokenHeader: 'X-Auth-Request-Access-Token' },
    }, expect.anything());
    expect(fields().props.status).toBe('signed-in');
    await view.press('connection-profile-save-confirm');
    expect(view.onSubmit).toHaveBeenCalledWith({
      name: '', serverUrl: 'https://example.test', username: '', password: 'server-password', headers: {},
      oidc: { issuer: 'https://login.example.test/realms/main', clientId: 'opencode-mobile', scopes: 'openid profile email offline_access', tokenHeader: 'X-Auth-Request-Access-Token' },
    });
  });
  it('blocks an enabled OpenID Connect block with an invalid issuer', async () => {
    const view = await form();
    view.change('connection-profile-url-input', 'https://example.test');
    await view.press('connection-profile-continue');
    const fields = () => { const value = find(view.runtime.value, 'OidcFields'); if (!value) throw new Error('Missing OidcFields'); return value; };
    fields().props.onChange({ enabled: true });
    view.runtime.flush();
    fields().props.onChange({ clientId: 'opencode-mobile' });
    view.runtime.flush();
    await view.press('connection-profile-save-confirm');
    expect(view.element('connection-profile-error').props.children).toBe('settings:connection.errors.oidcIssuer');
    expect(view.onSubmit).not.toHaveBeenCalled();
  });
  it('rejects reserved header names before probing again', async () => {    const view = await form();
    view.change('connection-profile-url-input', 'http://example.test');
    await view.press('connection-profile-continue');
    await view.press('connection-profile-headers-toggle');
    await view.press('connection-profile-header-add');
    view.change('connection-profile-header-name-0', 'Authorization');
    view.change('connection-profile-header-value-0', 'Bearer token');
    await view.press('connection-profile-save-confirm');
    expect(view.element('connection-profile-error').props.children).toBe('settings:connection.errors.headerReserved');
    expect(view.probe).toHaveBeenCalledOnce();
    expect(view.onSubmit).not.toHaveBeenCalled();
  });
  it('ignores a probe completed after Back and guards duplicate Continue', async () => {
    const view = await form();
    const gate = deferred<{ status: string; contract: string }>();
    view.probe.mockReturnValue(gate.promise);
    view.change('connection-profile-url-input', 'http://example.test');
    view.element('connection-profile-continue').props.onPress();
    view.element('connection-profile-continue').props.onPress();
    await view.runtime.settle();
    expect(view.probe).toHaveBeenCalledOnce();
    expect(view.onBusyChange).toHaveBeenLastCalledWith(true);
    await view.press('Button');
    expect(view.onDismiss).toHaveBeenCalledOnce();
    expect(view.onBusyChange).toHaveBeenLastCalledWith(false);
    gate.resolve({ status: 'detected', contract: 'v2' });
    await view.runtime.settle();
    expect(find(view.runtime.value, 'connection-profile-name-input')).toBeUndefined();
  });
});
