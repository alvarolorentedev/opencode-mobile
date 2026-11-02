import { describe, expect, it, vi } from 'vitest';

import { OIDC_DEFAULT_TOKEN_HEADER, isSecureOidcUrl, isValidOidcRedirectUri, normalizeOidcIssuer, oidcConfigError, oidcSessionKey, parseConnectionOidc, sameConnectionOidc, toConnectionOidc } from '@/shared/contracts/connection-oidc';
import { issuerMatches, parseOidcRedirect } from '@/shared/auth/oidc/redirect';
import { parseOidcDiscovery } from '@/shared/auth/oidc/discovery';
import { parseOidcTokenResponse } from '@/shared/auth/oidc/token-endpoint';


vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));

describe('OpenID Connect contract', () => {
  it('normalizes issuers and rejects unsafe ones', () => {
    expect(normalizeOidcIssuer('HTTPS://login.example.com/realms/main/')).toBe('https://login.example.com/realms/main');
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
  it('reads a code only from the configured app callback', () => {
    const callback = 'opencodemobile://oidc-callback';
    expect(parseOidcRedirect(`${callback}?code=abc&state=xyz`, callback)).toEqual({ code: 'abc', state: 'xyz' });
    expect(parseOidcRedirect(`${callback}#code=abc&state=xyz`, callback)).toEqual({ code: 'abc', state: 'xyz' });
    for (const url of ['https://app.test/cb?code=abc', 'other://oidc-callback?code=abc', `${callback}/extra?code=abc`,
      `${callback}?code=a&code=b&state=x`, `${callback}?state=x#state=y&code=a`, `${callback}?code=a&error=denied`, 'malformed?code=abc']) {
      expect(() => parseOidcRedirect(url, callback)).toThrow();
    }
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
    expect(parseOidcTokenResponse({ access_token: 'invalid\r\nvalue' })).toBeUndefined();
    expect(parseOidcTokenResponse({ access_token: 'access', refresh_token: 'invalid\u0000value' })).toBeUndefined();
    expect(parseOidcTokenResponse({ access_token: 'invalid\u0100value' })).toBeUndefined();
  });
});

describe('OIDC endpoint security', () => {
  it.each(['http://idp.test', 'http://localhost.evil.test', 'https://user:private@idp.test', 'https://idp.test/#fragment', 'https://idp.test/with space', 'file:///token', 'https:invalid'])('rejects insecure endpoint %s', (url) => {
    expect(isSecureOidcUrl(url)).toBe(false);
    expect(normalizeOidcIssuer(url)).toBe('');
    expect(parseOidcDiscovery({ issuer: 'https://idp.test', authorization_endpoint: url, token_endpoint: 'https://idp.test/token' }, 'https://idp.test')).toBeUndefined();
    expect(parseOidcDiscovery({ issuer: 'https://idp.test', authorization_endpoint: 'https://idp.test/auth', token_endpoint: url }, 'https://idp.test')).toBeUndefined();
  });
  it.each(['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080'])('permits only explicit loopback HTTP development endpoints %s', (url) => {
    expect(isSecureOidcUrl(url)).toBe(true);
  });
  it('permits HTTPS discovered endpoints on a different provider host', () => {
    expect(parseOidcDiscovery({ issuer: 'https://idp.test', authorization_endpoint: 'https://login.idp.test/auth', token_endpoint: 'https://tokens.idp.test/token' }, 'https://idp.test')).toBeDefined();
  });
  it.each(['javascript:alert(1)', 'data:text/html,hello', 'file:///cb', 'https://app.test/oidc-callback', 'exp://localhost/--/oidc-callback', 'other://oidc-callback', 'opencodemobile://other', 'opencodemobile://oidc-callback?code=x'])('rejects unregistered redirect URI %s', (uri) => {
    expect(isValidOidcRedirectUri(uri)).toBe(false);
  });
});
