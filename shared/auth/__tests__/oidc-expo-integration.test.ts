import { createHash, randomFillSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOidcAuthorization } from '@/shared/auth/oidc/flow';

const mocks = vi.hoisted(() => ({ browser: vi.fn(), exchange: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default } }));
vi.mock('expo-linking', () => ({}));
vi.mock('expo-constants', () => ({ default: {}, ExecutionEnvironment: {} }));
vi.mock('expo-modules-core', () => ({ Platform: { OS: 'ios' }, CodedError: class extends Error { constructor(_code: string, message: string) { super(message); } } }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: mocks.browser }));
vi.mock('expo-crypto', () => ({
  getRandomValues: (bytes: Uint8Array) => randomFillSync(bytes),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, CryptoEncoding: { BASE64: 'base64' },
  digestStringAsync: async (_algorithm: string, input: string) => createHash('sha256').update(input).digest('base64'),
}));
vi.mock('@/shared/platform/auth-session', async () => ({
  ...await import('expo-auth-session'),
  CodeChallengeMethod: { S256: 'S256' }, ResponseType: { Code: 'code' },
}));
vi.mock('@/shared/auth/oidc/discovery', () => ({ discoverOidc: async () => ({ authorizationEndpoint: 'https://idp.test/auth?tenant=acme&state=untrusted&code_challenge=untrusted', tokenEndpoint: 'https://idp.test/token' }) }));
vi.mock('@/shared/auth/oidc/token-endpoint', () => ({ exchangeOidcAuthorizationCode: mocks.exchange }));
const oidc = { issuer: 'https://idp.test', clientId: 'app', scopes: 'openid', tokenHeader: 'X-Token' };
beforeEach(() => { vi.stubGlobal('__DEV__', false); vi.clearAllMocks(); mocks.exchange.mockResolvedValue({ accessToken: 'synthetic' }); });
afterEach(() => vi.unstubAllGlobals());

describe('installed Expo AuthRequest integration', () => {
  it('preserves provider query parameters and derives a real S256 challenge with state validation', async () => {
    mocks.browser.mockImplementation(async (url, redirect) => ({ type: 'success', url: `${redirect}?code=code&state=${new URL(url).searchParams.get('state')}` }));
    await runOidcAuthorization(oidc);
    const url = new URL(mocks.browser.mock.calls[0][0]);
    const verifier = mocks.exchange.mock.calls[0][0].codeVerifier;
    expect(verifier).toMatch(/^[A-Za-z0-9]{128}$/);
    expect(url.searchParams.get('tenant')).toBe('acme');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).not.toBe('untrusted');
  });
  it('rejects mismatched state using the installed library and never exchanges the code', async () => {
    mocks.browser.mockResolvedValue({ type: 'success', url: 'opencodemobile://oidc-callback?code=code&state=wrong' });
    await expect(runOidcAuthorization(oidc)).rejects.toMatchObject({ code: 'sign-in-failed' });
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
