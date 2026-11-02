import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOidcDiscoveryCache, discoverOidc } from '@/shared/auth/oidc/discovery';
import { refreshOidcAccessToken } from '@/shared/auth/oidc/token-endpoint';

const transport = vi.hoisted(() => vi.fn());
vi.mock('expo/fetch', () => ({ fetch: transport }));
afterEach(() => { vi.clearAllMocks(); clearOidcDiscoveryCache(); });

describe('OIDC provider transport boundary', () => {
  it('uses Expo redirect rejection for discovery and token POSTs', async () => {
    transport.mockResolvedValueOnce(new Response(JSON.stringify({ issuer: 'https://idp.test', authorization_endpoint: 'https://idp.test/auth', token_endpoint: 'https://idp.test/token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'synthetic', expires_in: 3600 })));
    await discoverOidc('https://idp.test');
    await refreshOidcAccessToken({ tokenEndpoint: 'https://idp.test/token', clientId: 'app', refreshToken: 'synthetic-refresh' });
    expect(transport.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    expect(transport.mock.calls[1][1]).toMatchObject({ redirect: 'error', method: 'POST' });
    expect(transport.mock.calls[1][0]).toBe('https://idp.test/token');
  });
  it.each(['http://idp.test/token', 'https://user:private@idp.test/token'])('never submits credentials to unsafe token endpoint %s', async (tokenEndpoint) => {
    await expect(refreshOidcAccessToken({ tokenEndpoint, clientId: 'app', refreshToken: 'synthetic' })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('never fetches an insecure production issuer', async () => {
    await expect(discoverOidc('http://idp.test')).rejects.toMatchObject({ code: 'discovery' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('does not display arbitrary token error descriptions', async () => {
    transport.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client', error_description: 'private-value' }), { status: 400 }));
    await expect(refreshOidcAccessToken({ tokenEndpoint: 'https://idp.test/token', clientId: 'app', refreshToken: 'synthetic' })).rejects.toThrow('The OpenID Connect token request failed (400). Check the provider configuration.');
  });
});
