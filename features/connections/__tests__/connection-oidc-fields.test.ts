import { describe, expect, it, vi } from 'vitest';

import { uiImports } from '../../../tests/helpers/ui.mjs';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[] | undefined, testID: string): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, testID)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.props?.testID === testID || root.type === testID) return root;
  return find(root.props?.children, testID);
}

async function fields(props: Record<string, unknown> = {}) {
  const runtime = hookRuntime();
  const { ConnectionOidcFields } = await loadTs('features/connections/ui/connection-oidc-fields.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }), Fragment: 'Fragment' },
    'react-i18next': { useTranslation: () => ({ t: (key: string, variables?: Record<string, unknown>) => variables?.uri ? `${key}:${variables.uri}` : key }) },
    'react-native': { View: 'View', StyleSheet: { create: (styles: unknown) => styles } },
    '@/shared/ui/settings/setting-rows': { SettingField: 'Input', SettingSwitchRow: 'SwitchRow' },
  }, { Error });
  runtime.mount(ConnectionOidcFields, {
    status: 'unknown',
    defaultRedirectUri: 'opencodemobile://oidc-callback',
    disabled: false,
    palette: {},
    onChange: vi.fn(),
    onSignIn: vi.fn(),
    ...props,
  });
  const element = (id: string) => { const value = find(runtime.value, id); if (!value) throw new Error(`Missing ${id}`); return value; };
  return { runtime, element, value: (id: string) => find(runtime.value, id) };
}

const disabledValue = { enabled: false, issuer: '', clientId: '', scopes: 'openid profile email offline_access', tokenHeader: 'X-Auth-Request-Access-Token', redirectUri: '' };
const enabledValue = { ...disabledValue, enabled: true };

describe('OpenID Connect connection fields', () => {
  it('hides provider fields until the option is enabled', async () => {
    const view = await fields({ value: disabledValue });
    expect(view.element('SwitchRow')).toBeDefined();
    expect(view.value('connection-oidc-issuer-input')).toBeUndefined();
    view.element('SwitchRow').props.onValueChange(true);
    expect(view.element('SwitchRow').props.value).toBe(false);
  });

  it('collects issuer, client id, scopes and the redirect URI', async () => {
    const onChange = vi.fn();
    const view = await fields({ value: enabledValue, onChange });
    view.element('connection-oidc-issuer-input').props.onChangeText('https://login.example.test/realms/main');
    expect(onChange).toHaveBeenLastCalledWith({ issuer: 'https://login.example.test/realms/main' });
    view.element('connection-oidc-client-id-input').props.onChangeText('opencode-mobile');
    expect(onChange).toHaveBeenLastCalledWith({ clientId: 'opencode-mobile' });
    view.element('connection-oidc-scopes-input').props.onChangeText('openid offline_access');
    expect(onChange).toHaveBeenLastCalledWith({ scopes: 'openid offline_access' });
    view.element('connection-oidc-token-header-input').props.onChangeText('X-Access-Token');
    expect(onChange).toHaveBeenLastCalledWith({ tokenHeader: 'X-Access-Token' });
    expect(view.element('connection-oidc-token-header-input').props.value).toBe('X-Auth-Request-Access-Token');
    expect(view.element('connection-oidc-redirect-input').props.placeholder).toBe('opencodemobile://oidc-callback');
    expect(view.element('connection-oidc-status').props.children).toBe('settings:connection.oidc.status.unknown');
  });

  it('shows the session state and a localized sign-in error', async () => {
    const onSignIn = vi.fn();
    const view = await fields({ value: enabledValue, status: 'expired', error: 'Nope', onSignIn });
    expect(view.element('connection-oidc-status').props.children).toBe('settings:connection.oidc.status.expired');
    expect(view.element('connection-oidc-error').props.children).toBe('Nope');
    view.element('connection-oidc-sign-in').props.onPress();
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});
