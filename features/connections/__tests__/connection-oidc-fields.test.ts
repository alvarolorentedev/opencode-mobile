// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import '../../../tests/helpers/native-primitives';

import { ConnectionOidcFields } from '@/features/connections/ui/connection-oidc-fields';
import { SettingSwitchRow } from '@/shared/ui/settings/setting-rows';
import { Colors } from '@/shared/ui/theme/theme';
import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, variables?: Record<string, unknown>) => variables?.uri ? `${key}:${variables.uri}` : key }) }));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'android' }));

type Element = { type: unknown; props: Record<string, any> };
function find(root: Element | Element[] | undefined, testID: string | typeof SettingSwitchRow): Element | undefined {
  if (Array.isArray(root)) return root.map((child) => find(child, testID)).find(Boolean);
  if (!root || typeof root !== 'object') return;
  if (root.props?.testID === testID || root.type === testID) return root;
  return find(root.props?.children, testID);
}

function fields(props: Pick<Parameters<typeof ConnectionOidcFields>[0], 'value'> & Partial<Parameters<typeof ConnectionOidcFields>[0]>) {
  const runtime = renderHook(ConnectionOidcFields, {
    status: 'unknown', defaultRedirectUri: 'opencodemobile://oidc-callback', disabled: false,
    palette: Colors.light, onChange: vi.fn(), onSignIn: vi.fn(), ...props,
  });
  const element = (id: string | typeof SettingSwitchRow) => {
    const value = find(runtime.result.current, id);
    if (!value) throw new Error(`Missing ${String(id)}`);
    return value;
  };
  return { element, value: (id: string) => find(runtime.result.current, id) };
}

const disabledValue = { enabled: false, issuer: '', clientId: '', scopes: 'openid profile email offline_access', tokenHeader: 'X-Auth-Request-Access-Token', redirectUri: '' };
const enabledValue = { ...disabledValue, enabled: true };

describe('OpenID Connect connection fields', () => {
  it('hides provider fields until the option is enabled', async () => {
    const view = await fields({ value: disabledValue });
    expect(view.element(SettingSwitchRow)).toBeDefined();
    expect(view.value('connection-oidc-issuer-input')).toBeUndefined();
    view.element(SettingSwitchRow).props.onValueChange(true);
    expect(view.element(SettingSwitchRow).props.value).toBe(false);
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
