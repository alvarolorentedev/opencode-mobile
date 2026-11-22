// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionProfileDialog } from '@/features/connections/ui/connection-profile-dialog';
import { ConnectionOidcFields } from '@/features/connections/ui/connection-oidc-fields';
import type { WorkspaceRegistry } from '@/runtime/workspace/workspace-context';
import type { ConnectionProbeResult } from '@/shared/protocol/opencode/client';
import { Button } from '@/shared/ui/button';
import { connectionViewProbe } from '../../../tests/helpers/connection-view-probe';
import { deferred } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'web' }));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[], testID: unknown): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, testID)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.props?.testID === testID || root.type === testID) return root;
  return find(root.props?.children, testID);
}
function form(onSubmit = vi.fn()) {
  const probe = vi.fn<() => Promise<ConnectionProbeResult>>(async () => ({ status: 'detected', contract: 'v2' }));
  const signIn = vi.fn(async () => ({ accessToken: 'token', expiresAt: Date.now() + 3600_000, tokenType: 'Bearer', issuer: 'https://login.example.test/realms/main', clientId: 'opencode-mobile' }));
  const controls = { connectionProfiles: { probe, signIn, oidcStatus: async () => 'signed-out' } } as unknown as WorkspaceRegistry['connectionControls'];
  const onDismiss = vi.fn();
  const onBusyChange = vi.fn();
  const runtime = renderHook(ConnectionProfileDialog, { title: 'Add connection', submitLabel: 'Save', onSubmit, onDismiss, onBusyChange }, connectionViewProbe(controls));
  const element = (id: unknown) => { const value = find(runtime.result.current, id); if (!value) throw new Error(`Missing ${String(id)}`); return value; };
  const change = (id: string, value: string) => act(async () => { await element(id).props.onChangeText(value); });
  const press = async (id: unknown) => act(async () => { await element(id).props.onPress(); });
  return { runtime, probe, signIn, onSubmit, onDismiss, onBusyChange, element, change, press };
}

describe('manual connection form', () => {
  it('shows V2 details without a username and preserves values when changing the address', async () => {
    const view = form();
    await view.change('connection-profile-url-input', 'http://192.168.1.10:49374');
    await view.press('connection-profile-continue');
    expect(find(view.runtime.result.current, 'connection-profile-username-input')).toBeUndefined();
    expect(view.element('connection-profile-name-input').props.placeholder).toBe('192.168.1.10');
    await view.change('connection-profile-name-input', 'Office');
    await view.change('connection-profile-password-input', 'secret');
    await view.press('connection-profile-change');
    expect(view.element('connection-profile-url-input').props.value).toBe('http://192.168.1.10:49374');
    await view.press('connection-profile-continue');
    expect(view.element('connection-profile-name-input').props.value).toBe('Office');
    expect(view.element('connection-profile-password-input').props.value).toBe('secret');
  });
  it('preserves uncertainty and allows V1 custom credentials', async () => {
    const view = form();
    view.probe.mockResolvedValue({ status: 'authentication-required' } as any);
    await view.change('connection-profile-url-input', 'http://example.test');
    await view.press('connection-profile-continue');
    expect(view.element('connection-profile-detection').props.children).toBe('settings:connection.setup.identify');
    expect(find(view.runtime.result.current, 'connection-profile-username-input')).toBeUndefined();
    await view.press('connection-profile-custom-username');
    await view.change('connection-profile-username-input', 'alice');
    await view.change('connection-profile-password-input', 'secret');
    view.probe.mockResolvedValue({ status: 'detected', contract: 'v1' });
    await view.press('connection-profile-save-confirm');
    expect(view.onSubmit).toHaveBeenCalledWith({ name: '', serverUrl: 'http://example.test', username: 'alice', password: 'secret', headers: {} });
  });
  it('collects validated custom headers and hides them by default', async () => {
    const view = form();
    await view.change('connection-profile-url-input', 'http://example.test');
    await view.press('connection-profile-continue');
    expect(find(view.runtime.result.current, 'connection-profile-header-name-0')).toBeUndefined();
    await view.press('connection-profile-headers-toggle');
    await view.press('connection-profile-header-add');
    await view.change('connection-profile-header-name-0', 'CF-Access-Client-Id');
    await view.change('connection-profile-header-value-0', 'client-id');
    expect(view.element('connection-profile-header-value-0').props.secureTextEntry).toBe(true);
    await view.press('connection-profile-header-visibility');
    expect(view.element('connection-profile-header-value-0').props.secureTextEntry).toBe(false);
    await view.press('connection-profile-header-add');
    await view.change('connection-profile-header-name-1', 'CF-Access-Client-Secret');
    await view.change('connection-profile-header-value-1', 'client-secret');
    await view.press('connection-profile-save-confirm');
    expect(view.onSubmit).toHaveBeenCalledWith({
      name: '', serverUrl: 'http://example.test', username: '', password: '',
      headers: { 'CF-Access-Client-Id': 'client-id', 'CF-Access-Client-Secret': 'client-secret' },
    });
  });
  it('collects OpenID Connect settings and only signs in on demand', async () => {
    const view = form();
    await view.change('connection-profile-url-input', 'https://example.test');
    await view.press('connection-profile-continue');
    const fields = () => { const value = find(view.runtime.result.current, ConnectionOidcFields); if (!value) throw new Error('Missing OidcFields'); return value; };
    const patch = (value: Record<string, unknown>) => act(() => fields().props.onChange(value));
    expect(fields().props.value.enabled).toBe(false);
    expect(find(view.runtime.result.current, 'connection-profile-password-input')).toBeDefined();
    patch({ enabled: true });
    expect(fields().props.value.enabled).toBe(true);
    expect(find(view.runtime.result.current, 'connection-profile-password-input')).toBeDefined();
    patch({ issuer: 'https://login.example.test/realms/main' });
    patch({ clientId: 'opencode-mobile' });
    await view.change('connection-profile-password-input', 'server-password');
    await act(async () => { await fields().props.onSignIn(); });
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
    const view = form();
    await view.change('connection-profile-url-input', 'https://example.test');
    await view.press('connection-profile-continue');
    const fields = () => { const value = find(view.runtime.result.current, ConnectionOidcFields); if (!value) throw new Error('Missing OidcFields'); return value; };
    act(() => fields().props.onChange({ enabled: true }));
    act(() => fields().props.onChange({ clientId: 'opencode-mobile' }));
    await view.press('connection-profile-save-confirm');
    expect(view.element('connection-profile-error').props.children).toBe('settings:connection.errors.oidcIssuer');
    expect(view.onSubmit).not.toHaveBeenCalled();
  });
  it('rejects reserved header names before probing again', async () => {    const view = form();
    await view.change('connection-profile-url-input', 'http://example.test');
    await view.press('connection-profile-continue');
    await view.press('connection-profile-headers-toggle');
    await view.press('connection-profile-header-add');
    await view.change('connection-profile-header-name-0', 'Authorization');
    await view.change('connection-profile-header-value-0', 'Bearer token');
    await view.press('connection-profile-save-confirm');
    expect(view.element('connection-profile-error').props.children).toBe('settings:connection.errors.headerReserved');
    expect(view.probe).toHaveBeenCalledOnce();
    expect(view.onSubmit).not.toHaveBeenCalled();
  });
  it('ignores a probe completed after Back and guards duplicate Continue', async () => {
    const view = form();
    const gate = deferred<ConnectionProbeResult>();
    view.probe.mockReturnValue(gate.promise);
    await view.change('connection-profile-url-input', 'http://example.test');
    await act(async () => {
      view.element('connection-profile-continue').props.onPress();
      view.element('connection-profile-continue').props.onPress();
    });
    expect(view.probe).toHaveBeenCalledOnce();
    expect(view.onBusyChange).toHaveBeenLastCalledWith(true);
    await view.press(Button);
    expect(view.onDismiss).toHaveBeenCalledOnce();
    expect(view.onBusyChange).toHaveBeenLastCalledWith(false);
    await act(async () => { gate.resolve({ status: 'detected', contract: 'v2' }); });
    expect(find(view.runtime.result.current, 'connection-profile-name-input')).toBeUndefined();
  });
});
