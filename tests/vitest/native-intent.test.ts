import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from '@babel/core';
import { describe, expect, it } from 'vitest';

import { loadTs } from '../helpers/runtime.mjs';

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

describe('native inbound share routing', () => {
  it('scrubs legacy URL credentials using the installed getter-only native URL', async () => {
    const urls = await loadTs('lib/opencode/client/url.ts', { './types': { defaultConnectionSettings: { serverUrl: 'http://localhost' } } }, { URL: native.URL });
    const value = 'https://alice:private@host.test/proxy?directory=/repo';
    expect(urls.normalizeServerUrl(value).valid).toBe(false);
    expect(urls.stripServerUrlCredentials(value)).toBe('https://host.test/proxy?directory=/repo');
    expect(urls.stripServerUrlCredentials('http://alice:private@')).toBe('http://');
  });
  it.each([true, false])('opens the preview on Android with initial=%s', async (initial) => {
    const path = 'opencodemobile://expo-sharing';
    expect(new native.URL(path).hostname).toBe('');
    const { redirectSystemPath } = await loadTs('app/+native-intent.ts', {}, { URL: native.URL });
    expect(await redirectSystemPath({ path, initial })).toMatch(/^\/share\?receipt=/);
  });

  it('routes repeat receipts and only matches the exact share host', async () => {
    const { redirectSystemPath } = await loadTs('app/+native-intent.ts', {}, { URL: native.URL });
    const first = await redirectSystemPath({ path: 'opencodemobile://expo-sharing', initial: false });
    for (const path of ['opencodemobile://expo-sharing/', 'opencodemobile://expo-sharing?receipt=2', 'opencodemobile://expo-sharing#share']) {
      const next = await redirectSystemPath({ path, initial: false });
      expect(next).toMatch(/^\/share\?receipt=/);
      expect(next).not.toBe(first);
    }
    for (const path of ['opencodemobile://session/one', 'opencodemobile://pair', 'opencodemobile://expo-sharing-other', 'opencodemobile://other/expo-sharing', '/share', 'invalid']) {
      expect(await redirectSystemPath({ path, initial: true })).toBe(path);
    }
  });
});
