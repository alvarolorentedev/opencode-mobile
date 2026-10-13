import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const { patchSharingSource, prepareAndroidSharing } = createRequire(import.meta.url)('../../scripts/prepare-android-sharing.cjs');
const root = path.resolve('node_modules/expo-sharing');

describe('Android sharing build patch', () => {
  it.each([['SimpleShareIntentDataParser.kt', false], ['ResolvingShareIntentDataParser.kt', true]])('patches %s completely and is idempotent', (name, resolved) => {
    const source = readFileSync(path.join(root, 'android/src/main/java/expo/modules/sharing/dataParsers', String(name)), 'utf8');
    const patched = patchSharingSource(source, resolved);
    expect(patchSharingSource(patched, resolved)).toBe(patched);
    expect(patched).toContain('extractTextPayload(intent) + listOfNotNull(uri?.let');
    expect(patched).toContain('uris?.take(10)?.map');
    expect(patched).not.toContain('return if (type == "text/plain")');
    if (resolved) {
      expect(patched).toContain('File.createTempFile("opencode-share-"');
      expect(patched).toContain('total > 10L * 1024 * 1024');
      expect(patched).toContain('else "unavailable:"');
      expect(patched).not.toContain('File(context.cacheDir, fileName)');
    }
  });
  it('rejects a changed upstream receiver without silently accepting an incomplete patch', () => {
    expect(() => patchSharingSource('class Unknown {}', false)).toThrow('Unrecognized');
  });
  it('applies on clean installs and rejects unsupported versions before writing', () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'sharing-patch-'));
    try {
      const target = path.join(temporary, 'node_modules/expo-sharing');
      cpSync(root, target, { recursive: true });
      prepareAndroidSharing(temporary); prepareAndroidSharing(temporary);
      const before = readFileSync(path.join(target, 'android/src/main/java/expo/modules/sharing/dataParsers/SimpleShareIntentDataParser.kt'), 'utf8');
      writeFileSync(path.join(target, 'package.json'), JSON.stringify({ version: '58.0.0' }));
      expect(() => prepareAndroidSharing(temporary)).toThrow('expected 57.0.22');
      expect(readFileSync(path.join(target, 'android/src/main/java/expo/modules/sharing/dataParsers/SimpleShareIntentDataParser.kt'), 'utf8')).toBe(before);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
});
