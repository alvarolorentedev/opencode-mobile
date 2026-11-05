import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Android update install-time patch', () => {
  it('defers installation to an explicit request and exposes download state', () => {
    const patch = readFileSync('patches/expo-in-app-updates+0.13.0.patch', 'utf8');
    expect(patch).toContain('-        appUpdateManager.completeUpdate()');
    expect(patch).toContain('"downloaded" to (info.installStatus() == InstallStatus.DOWNLOADED)');
  });
});
