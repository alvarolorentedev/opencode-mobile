import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from '@babel/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redirectSystemPath } from '@/features/sharing/model/native-intent';
import * as urls from '@/shared/contracts/server-url';

const { systemPath } = vi.hoisted(() => ({ systemPath: { value: '/' } }));
vi.mock('@/shared/platform/system-path', () => ({ getSystemPath: () => systemPath.value }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

// Use the installed native URL implementation; Node's URL hides this regression.
const source = readFileSync('node_modules/react-native/Libraries/Blob/URL.js', 'utf8');
const code = transformSync(source, {
  filename: 'URL.js', configFile: false, babelrc: false,
  presets: [['@react-native/babel-preset', { enableBabelRuntime: false }]],
})!.code!;
const native: any = {};
runInNewContext(code, {
  exports: native,
  require(name: string) {
    if (name === './NativeBlobModule') return { default: null, __esModule: true };
    if (name === './URLSearchParams') return {};
    throw new Error(`Unexpected native URL import: ${name}`);
  },
});

describe('native inbound routing', () => {
  beforeEach(() => { vi.stubGlobal('URL', native.URL); systemPath.value = '/'; });
  afterEach(() => vi.unstubAllGlobals());
  it.each([true, false])('opens a shared session with initial=%s', async (initial) => {

    const path = 'opencode://session/ses_ABC-123';
    expect(await redirectSystemPath({ path, initial })).toBe('/session/ses_ABC-123');
    expect(await redirectSystemPath({
      path: `${path}?id=other&project=/other&connectionScope=saved&server=https://example.test&prompt=hello#fragment`,
      initial,
    })).toBe('/session/ses_ABC-123');
  });

  it('ignores malformed session links and app-specific actions on the shared scheme', async () => {

    for (const path of [
      'opencode://session/',
      'opencode://session/ses_123/other',
      'opencode://session/ses_123%2Fother',
      'opencode://session/..',
      'opencode://user@session/ses_123',
      'opencode://session:123/ses_123',
      'opencode://pair',
      'opencode://expo-sharing',
      'opencode://oidc-callback',
    ]) {
      expect(await redirectSystemPath({ path, initial: false }), path).toBeNull();
    }
  });

  it('scrubs legacy URL credentials using the installed getter-only native URL', async () => {
    const value = 'https://alice:private@host.test/proxy?directory=/repo';
    expect(urls.normalizeServerUrl(value).valid).toBe(false);
    expect(urls.stripServerUrlCredentials(value)).toBe('https://host.test/proxy?directory=/repo');
    expect(urls.stripServerUrlCredentials('http://alice:private@')).toBe('http://');
  });
  it.each([true, false])('opens the preview on Android with initial=%s', async (initial) => {
    const path = 'opencodemobile://expo-sharing';
    expect(new native.URL(path).hostname).toBe('');

    expect(await redirectSystemPath({ path, initial })).toMatch(/^\/share\?receipt=/);
  });

  it('returns an OpenID Connect callback to the screen that started sign-in', async () => {
    systemPath.value = '/settings';
    expect(await redirectSystemPath({ path: 'opencodemobile://oidc-callback?code=abc&state=xyz', initial: false })).toBe('/settings');
    expect(await redirectSystemPath({ path: 'opencodemobile://oidc-callback#code=abc', initial: false })).toBe('/settings');
    expect(await redirectSystemPath({ path: 'other://oidc-callback?code=abc', initial: false })).toBe('other://oidc-callback?code=abc');
    expect(await redirectSystemPath({ path: 'opencodemobile://oidc-callback-other', initial: false })).toBe('opencodemobile://oidc-callback-other');
  });

  it('routes repeat receipts and only matches the exact share host', async () => {
    const first = await redirectSystemPath({ path: 'opencodemobile://expo-sharing', initial: false });
    for (const path of ['opencodemobile://expo-sharing/', 'opencodemobile://expo-sharing?receipt=2', 'opencodemobile://expo-sharing#share']) {
      const next = await redirectSystemPath({ path, initial: false });
      expect(next).toMatch(/^\/share\?receipt=/);
      expect(next).not.toBe(first);
    }
    for (const path of ['opencodemobile://session/one?project=%2Frepo&connectionScope=saved', 'opencodemobile://pair', 'opencodemobile://expo-sharing-other', 'opencodemobile://other/expo-sharing', '/share', 'invalid']) {
      expect(await redirectSystemPath({ path, initial: true })).toBe(path);
    }
  });
});
