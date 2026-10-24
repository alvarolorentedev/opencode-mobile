import { describe, expect, it } from 'vitest';

import { getAddableProviders, hasConfigurableAuth } from '@/components/settings/settings-utils';
import { extractPairingCode, parseProviderOAuthRedirect } from '@/lib/opencode/oauth';

describe('parseProviderOAuthRedirect', () => {
  it('reads a code from the query string', () => {
    expect(parseProviderOAuthRedirect('opencodemobile://oauth?code=abc123')).toEqual({ code: 'abc123' });
  });

  it('reads a code from the fragment', () => {
    expect(parseProviderOAuthRedirect('opencodemobile://oauth#code=xyz')).toEqual({ code: 'xyz' });
  });

  it('prefers error_description over error', () => {
    expect(parseProviderOAuthRedirect('https://x/cb?error=access_denied&error_description=Nope')).toEqual({ error: 'Nope' });
  });

  it('returns nothing for an unrelated redirect', () => {
    expect(parseProviderOAuthRedirect('opencodemobile://oauth')).toEqual({});
  });
});

describe('extractPairingCode', () => {
  it('pulls a device code out of the instruction text', () => {
    expect(extractPairingCode('Enter code: 8F43-6FCF')).toBe('8F43-6FCF');
    expect(extractPairingCode('Enter code:ABCD-12345')).toBe('ABCD-12345');
  });

  it('returns nothing for paste-code instructions', () => {
    expect(extractPairingCode('Paste the authorization code here: ')).toBeUndefined();
    expect(extractPairingCode(undefined)).toBeUndefined();
    expect(extractPairingCode('')).toBeUndefined();
  });
});

describe('provider addability', () => {
  it('treats any auth method as configurable', () => {
    expect(hasConfigurableAuth('openai', [{ type: 'oauth', label: 'Sign in' }], 'v2')).toBe(true);
  });

  it('falls back to a generic API key only on V1', () => {
    expect(hasConfigurableAuth('openrouter', undefined, 'v1')).toBe(true);
    expect(hasConfigurableAuth('openrouter', undefined, 'v2')).toBe(false);
  });

  it('keeps configured providers so another account can be added, and only providers with a login method', () => {
    const providers = [
      { id: 'openai', label: 'OpenAI', configured: true },
      { id: 'no-auth', label: 'No auth', configured: false },
      { id: 'openrouter', label: 'OpenRouter', configured: false },
    ];
    const methods = { openai: [{ type: 'oauth' as const, label: 'Sign in' }] };

    // V2: a configured provider stays listed (add another account); providers
    // with no interactive method are excluded.
    expect(getAddableProviders(providers, methods, 'v2').map((provider) => provider.id)).toEqual(['openai']);
    // V1: the generic API-key fallback makes every provider addable.
    expect(getAddableProviders(providers, methods, 'v1').map((provider) => provider.id)).toEqual(['openai', 'no-auth', 'openrouter']);
  });
});
