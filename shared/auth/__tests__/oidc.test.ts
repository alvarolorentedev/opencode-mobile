import { createHash } from 'node:crypto';

import { base64urlnopad } from '@scure/base';
import { describe, expect, it, vi } from 'vitest';

import { OIDC_DEFAULT_TOKEN_HEADER, normalizeOidcIssuer, oidcConfigError, oidcSessionKey, parseConnectionOidc, sameConnectionOidc, toConnectionOidc } from '@/shared/contracts/connection-oidc';
import { buildOidcAuthorizationUrl, issuerMatches, parseOidcRedirect } from '@/shared/auth/oidc/redirect';
import { parseOidcDiscovery } from '@/shared/auth/oidc/discovery';
import { parseOidcTokenResponse } from '@/shared/auth/oidc/token-endpoint';
import { createPkcePair, sha256Base64Url } from '@/shared/auth/oidc/pkce';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_algorithm: string, bytes: Uint8Array) => {
    const digest = createHash('sha256').update(Buffer.from(bytes)).digest();
    return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
  },
  getRandomBytesAsync: async (count: number) => Uint8Array.from({ length: count }, (_, index) => index + 1),
}));

describe('OpenID Connect contract', () => {
  it('normalizes issuers and rejects unsafe ones', () => {
    expect(normalizeOidcIssuer('https://login.example.com/realms/main/')).toBe('https://login.example.com/realms/main');
    expect(normalizeOidcIssuer(' login.example.com/realms/main ')).toBe('https://login.example.com/realms/main');
    expect(normalizeOidcIssuer('https://user:secret@idp.example.com')).toBe('');
    expect(normalizeOidcIssuer('ftp://idp.example.com')).toBe('');
  });

  it('always keeps the openid scope and trims the client id', () => {
    expect(toConnectionOidc({ issuer: 'login.example.com', clientId: ' app ', scopes: 'profile email', tokenHeader: '' })).toEqual({
      issuer: 'https://login.example.com',
      clientId: 'app',
      scopes: 'profile email openid',
      tokenHeader: OIDC_DEFAULT_TOKEN_HEADER,
    });
    expect(oidcConfigError({ issuer: '', clientId: 'app', scopes: 'openid', tokenHeader: '' })).toBe('issuer');
    expect(oidcConfigError({ issuer: 'idp.test', clientId: '', scopes: 'openid', tokenHeader: '' })).toBe('clientId');
    expect(oidcConfigError({ issuer: 'idp.test', clientId: 'app', scopes: 'openid bad"scope', tokenHeader: '' })).toBe('scopes');
    expect(oidcConfigError({ issuer: 'idp.test', clientId: 'app', scopes: 'openid', tokenHeader: 'bad header' })).toBe('tokenHeader');
    expect(oidcConfigError({ issuer: 'idp.test', clientId: 'app', scopes: 'openid', tokenHeader: 'Authorization' })).toBe('tokenHeader');
    expect(oidcConfigError({ issuer: 'idp.test', clientId: 'app', scopes: 'openid', tokenHeader: 'X-Access-Token' })).toBeUndefined();
    expect(oidcConfigError({ issuer: 'idp.test', clientId: 'app', scopes: 'openid', tokenHeader: '', redirectUri: 'not a uri with spaces' })).toBe('redirectUri');
  });

  it('parses persisted values defensively and keeps stable session keys', () => {
    const oidc = parseConnectionOidc({ issuer: 'https://idp.test/', clientId: 'app' });
    expect(oidc).toEqual({ issuer: 'https://idp.test', clientId: 'app', scopes: 'openid profile email offline_access', tokenHeader: OIDC_DEFAULT_TOKEN_HEADER });
    expect(parseConnectionOidc({ issuer: '', clientId: 'app' })).toBeUndefined();
    expect(parseConnectionOidc(null)).toBeUndefined();
    expect(sameConnectionOidc(oidc, { ...oidc!, issuer: 'https://idp.test/' })).toBe(true);
    expect(sameConnectionOidc(oidc, { ...oidc!, tokenHeader: 'X-Access-Token' })).toBe(false);
    expect(oidcSessionKey('scope', oidc!)).toBe(oidcSessionKey('scope', { ...oidc!, issuer: 'https://idp.test/' }));
    expect(oidcSessionKey('scope', oidc!)).not.toBe(oidcSessionKey('other', oidc!));
  });
});

describe('authorization redirect', () => {
  it('builds an S256 authorization request', () => {
    const url = new URL(buildOidcAuthorizationUrl({
      authorizationEndpoint: 'https://idp.test/authorize',
      clientId: 'app',
      redirectUri: 'opencodemobile://oidc-callback',
      scopes: 'openid offline_access',
      state: 'state-1',
      codeChallenge: 'challenge-1',
    }));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('redirect_uri')).toBe('opencodemobile://oidc-callback');
  });

  it('reads a code from the query or the fragment', () => {
    expect(parseOidcRedirect('opencodemobile://oidc-callback?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' });
    expect(parseOidcRedirect('https://app.test/cb#code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' });
    expect(parseOidcRedirect('opencodemobile://oidc-callback?error=access_denied&error_description=Denied')).toMatchObject({
      error: 'access_denied',
      errorDescription: 'Denied',
    });
  });

  it('requires the discovery document to name the configured issuer', () => {
    const document = {
      issuer: 'https://idp.test/realms/main/',
      authorization_endpoint: 'https://idp.test/realms/main/auth',
      token_endpoint: 'https://idp.test/realms/main/token',
    };
    expect(parseOidcDiscovery(document, 'https://idp.test/realms/main')).toMatchObject({
      issuer: 'https://idp.test/realms/main',
      authorizationEndpoint: 'https://idp.test/realms/main/auth',
      tokenEndpoint: 'https://idp.test/realms/main/token',
    });
    expect(parseOidcDiscovery(document, 'https://evil.test/realms/main')).toBeUndefined();
    expect(parseOidcDiscovery({ ...document, token_endpoint: undefined }, 'https://idp.test/realms/main')).toBeUndefined();
    expect(issuerMatches('https://idp.test/realms/main', 'https://idp.test/realms/main/')).toBe(true);
  });
});

describe('token response', () => {
  it('computes expiry and keeps rotation optional', () => {
    expect(parseOidcTokenResponse({
      access_token: 'access', refresh_token: 'refresh', expires_in: '3600', token_type: 'Bearer', scope: 'openid',
    }, 1_000)).toEqual({
      accessToken: 'access', refreshToken: 'refresh', expiresAt: 3_601_000, tokenType: 'Bearer', scope: 'openid',
    });
    expect(parseOidcTokenResponse({ access_token: 'access' }, 0)).toMatchObject({ accessToken: 'access', expiresAt: 300_000, tokenType: 'Bearer' });
    expect(parseOidcTokenResponse({ refresh_token: 'refresh' }, 0)).toBeUndefined();
  });
});

describe('PKCE', () => {
  it('derives an RFC 7636 S256 challenge', async () => {
    const pair = await createPkcePair();
    const expected = base64urlnopad.encode(createHash('sha256').update(pair.verifier).digest());
    expect(pair.challenge).toBe(expected);
    expect(pair.challenge).toBe(await sha256Base64Url(pair.verifier));
    expect(pair.verifier).toMatch(/^[A-Za-z0-9\-_]{43}$/);
  });
});
