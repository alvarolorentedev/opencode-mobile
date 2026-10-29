import { describe, expect, it } from 'vitest';

import { bustConfigReadCache } from '@/lib/opencode/v2/config-read-cache';

describe('V2 config-read cache busting', () => {
  it('makes each file read URL unique without changing the path or location', () => {
    const url = new URL('https://host/api/fs/read//work/app/opencode.jsonc?location[directory]=%2Fwork%2Fapp');
    const first = bustConfigReadCache(url, 'GET');
    const second = bustConfigReadCache(url, 'GET');

    expect(first?.pathname).toBe(url.pathname);
    expect(first?.searchParams.get('location[directory]')).toBe('/work/app');
    expect(first?.searchParams.get('_')).toBeTruthy();
    expect(second?.searchParams.get('_')).not.toBe(first?.searchParams.get('_'));
  });

  it('leaves non-config reads and non-GET requests untouched', () => {
    expect(bustConfigReadCache(new URL('https://host/api/config'), 'GET')).toBeUndefined();
    expect(bustConfigReadCache(new URL('https://host/api/fs/read//work/app/opencode.jsonc'), 'POST')).toBeUndefined();
    expect(bustConfigReadCache(new URL('https://host/api/fs/read//work/app/assets/pixel.png'), 'GET')).toBeUndefined();
  });
});
