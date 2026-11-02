import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runOidcAuthorization } from '@/shared/auth/oidc/flow';

const mocks = vi.hoisted(() => ({ prompt: vi.fn(), exchange: vi.fn(), config: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@/shared/platform/auth-session', () => ({
  AuthRequest: class {
    state = 'expected-state'; codeVerifier = 'pkce-verifier';
    constructor(config: unknown) { mocks.config(config); }
    makeAuthUrlAsync = async () => 'https://idp.test/auth?state=expected-state';
    promptAsync = mocks.prompt;
  },
  CodeChallengeMethod: { S256: 'S256' }, ResponseType: { Code: 'code' },
}));
vi.mock('@/shared/auth/oidc/discovery', () => ({ discoverOidc: async () => ({ authorizationEndpoint: 'https://idp.test/auth', tokenEndpoint: 'https://idp.test/token' }) }));
vi.mock('@/shared/auth/oidc/token-endpoint', () => ({ exchangeOidcAuthorizationCode: mocks.exchange }));
const oidc = { issuer: 'https://idp.test', clientId: 'app', scopes: 'openid profile', tokenHeader: 'X-Token' };
beforeEach(() => { vi.clearAllMocks(); mocks.exchange.mockResolvedValue({ accessToken: 'synthetic' }); });

describe('Expo OIDC authorization flow', () => {
  it('delegates PKCE and browser state coordination to Expo and exchanges only a validated callback', async () => {
    mocks.prompt.mockResolvedValue({ type: 'success', url: 'opencodemobile://oidc-callback?code=auth-code&state=expected-state' });
    await runOidcAuthorization(oidc);
    expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({ usePKCE: true, codeChallengeMethod: 'S256', responseType: 'code' }));
    expect(mocks.exchange).toHaveBeenCalledWith(expect.objectContaining({ code: 'auth-code', codeVerifier: 'pkce-verifier', redirectUri: 'opencodemobile://oidc-callback' }));
  });
  it.each(['https://evil.test/cb?code=code&state=expected-state', 'opencodemobile://other?code=code&state=expected-state', 'opencodemobile://oidc-callback?code=code&state=wrong', 'malformed?code=code'])('rejects unexpected callback %s before token exchange', async (url) => {
    mocks.prompt.mockResolvedValue({ type: 'success', url });
    await expect(runOidcAuthorization(oidc)).rejects.toMatchObject({ code: 'sign-in-failed' });
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it('rejects unsupported callback overrides before opening the browser', async () => {
    await expect(runOidcAuthorization({ ...oidc, redirectUri: 'https://app.test/cb' })).rejects.toThrow();
    expect(mocks.prompt).not.toHaveBeenCalled();
  });
  it('does not echo provider error text', async () => {
    mocks.prompt.mockResolvedValue({ type: 'error', url: 'opencodemobile://oidc-callback?error=denied&state=expected-state&error_description=private-value' });
    await expect(runOidcAuthorization(oidc)).rejects.toThrow('The OpenID Connect provider rejected sign-in. Check the provider configuration.');
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it('does not exchange a callback after caller cancellation', async () => {
    const controller = new AbortController();
    mocks.prompt.mockImplementationOnce(async () => { controller.abort(); return { type: 'success', url: 'opencodemobile://oidc-callback?code=code&state=expected-state' }; });
    await expect(runOidcAuthorization(oidc, { signal: controller.signal })).rejects.toMatchObject({ code: 'sign-in-cancelled' });
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
