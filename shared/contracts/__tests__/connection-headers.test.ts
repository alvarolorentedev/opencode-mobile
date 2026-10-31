import { beforeEach, describe, expect, it } from 'vitest';

import { loadTs } from '../../../tests/helpers/runtime.mjs';

// The header model is a credential boundary: every value stays in SecureStore,
// AsyncStorage only ever sees connection metadata. These tests drive the real
// module with stubbed native boundaries.
async function loadHeadersModule(platform: 'android' | 'ios' | 'web' = 'android') {
  const secure = new Map<string, string>();
  const connectSecrets = new Map<string, string>();
  const module = await loadTs(['shared/storage/connection-headers.ts', 'shared/contracts/connection-headers.ts'], {
    'expo-secure-store': {
      getItemAsync: async (key: string) => secure.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => { secure.set(key, value); },
      deleteItemAsync: async (key: string) => { secure.delete(key); },
    },
    'react-native': { Platform: { OS: platform } },
    "@/shared/storage/cloud-link": { getConnectTestSecret: (key: string) => connectSecrets.get(key) ?? '', setConnectTestSecret: (key: string, value: string) => { if (value) connectSecrets.set(key, value); else connectSecrets.delete(key); } }
  });
  return { module, secure, connectSecrets };
}

describe('connection header validation', () => {
  let module: Awaited<ReturnType<typeof loadHeadersModule>>['module'];

  beforeEach(async () => { ({ module } = await loadHeadersModule()); });

  it('normalizes key/value rows and ignores blank rows', () => {
    expect(module.parseConnectionHeaders([])).toEqual({ headers: {} });
    expect(module.parseConnectionHeaders([
      { name: '  CF-Access-Client-Id  ', value: 'token-id' },
      { name: 'CF-Access-Client-Secret', value: ' token-secret ' },
      { name: '   ', value: '' },
    ])).toEqual({ headers: { 'CF-Access-Client-Id': 'token-id', 'CF-Access-Client-Secret': ' token-secret ' } });
  });

  it('rejects malformed names, values, duplicates, reserved headers, and overflow', () => {
    expect(module.parseConnectionHeaders([{ name: 'Bad Header', value: 'x' }])).toEqual({ error: 'name' });
    expect(module.parseConnectionHeaders([{ name: '', value: 'x' }])).toEqual({ error: 'name' });
    expect(module.parseConnectionHeaders([{ name: 'x'.repeat(129), value: 'x' }])).toEqual({ error: 'name' });
    expect(module.parseConnectionHeaders([{ name: 'X-Test', value: 'line\nbreak' }])).toEqual({ error: 'value' });
    expect(module.parseConnectionHeaders([{ name: 'x-test', value: 'a' }, { name: 'X-Test', value: 'b' }])).toEqual({ error: 'duplicate' });
    for (const name of ['Authorization', 'HOST', 'content-type', 'Transfer-Encoding', 'Upgrade']) {
      expect(module.parseConnectionHeaders([{ name, value: 'x' }])).toEqual({ error: 'reserved' });
    }
    const many = Array.from({ length: module.MAX_CONNECTION_HEADERS + 1 }, (_, index) => ({ name: `x-${index}`, value: 'v' }));
    expect(module.parseConnectionHeaders(many)).toEqual({ error: 'limit' });
  });

  it('sanitizes stored records before they reach a request', () => {
    expect(module.parseStoredConnectionHeaders(null)).toEqual({});
    expect(module.parseStoredConnectionHeaders(['x'])).toEqual({});
    expect(module.parseStoredConnectionHeaders({
      ' CF-Access-Client-Id ': 'id',
      Authorization: 'Bearer stolen',
      'Bad Header': 'nope',
      'X-Broken': 'line\nbreak',
      'X-Number': 42,
      'CF-Access-Client-Secret': 'secret',
    })).toEqual({ 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' });
  });

  it('compares headers without depending on insertion order or name casing', () => {
    expect(module.sameConnectionHeaders({ A: '1', B: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(module.sameConnectionHeaders({ A: '1' }, { A: '2' })).toBe(false);
    expect(module.sameConnectionHeaders(undefined, {})).toBe(true);
    expect(module.connectionHeadersKey({ B: '2', A: '1' })).toBe(module.connectionHeadersKey({ a: '1', b: '2' }));
  });
});

describe('connection header storage', () => {
  it('round-trips active and per-profile headers and deletes empty values', async () => {
    const { module, secure } = await loadHeadersModule();
    await module.saveConnectionHeaders({ 'CF-Access-Client-Id': 'id' });
    expect(await module.getConnectionHeaders()).toEqual({ 'CF-Access-Client-Id': 'id' });
    expect(secure.get('opencode-mobile.connection-headers')).toContain('id');

    await module.saveProfileHeaders('profile-1', { 'CF-Access-Client-Secret': 'secret' });
    expect(await module.getProfileHeaders('profile-1')).toEqual({ 'CF-Access-Client-Secret': 'secret' });
    expect(secure.has('opencode-mobile.connection-profile-headers.profile-1')).toBe(true);

    await module.saveProfileHeaders('profile-1', {});
    expect(secure.has('opencode-mobile.connection-profile-headers.profile-1')).toBe(false);
    await module.deleteProfileHeaders('profile-1');
    expect(await module.getProfileHeaders('profile-1')).toEqual({});
    expect(await module.getConnectionHeaders()).toEqual({ 'CF-Access-Client-Id': 'id' });
  });

  it('returns empty headers for missing or corrupt records', async () => {
    const { module, secure } = await loadHeadersModule();
    secure.set('opencode-mobile.connection-headers', '{not json');
    expect(await module.getConnectionHeaders()).toEqual({});
    secure.set('opencode-mobile.connection-profile-headers.p1', '[]');
    expect(await module.getProfileHeaders('p1')).toEqual({});
  });

  it('uses the in-memory test secret on web instead of SecureStore', async () => {
    const { module, secure, connectSecrets } = await loadHeadersModule('web');
    await module.saveProfileHeaders('p1', { 'CF-Access-Client-Secret': 'web-secret' });
    expect(connectSecrets.get('opencode-mobile.connection-profile-headers.p1')).toContain('web-secret');
    expect(secure.size).toBe(0);
    expect(await module.getProfileHeaders('p1')).toEqual({ 'CF-Access-Client-Secret': 'web-secret' });
  });
});
