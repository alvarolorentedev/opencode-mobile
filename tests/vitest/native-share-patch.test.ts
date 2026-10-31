import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Android sharing install-time patch', () => {
  it('pins and builds the reviewed receiver from source', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies['expo-sharing']).toBe('58.0.21');
    expect(pkg.expo.autolinking.android.buildFromSource).toEqual(['expo-sharing', 'expo-in-app-updates']);
    expect(readFileSync('patches/expo-sharing+58.0.21.patch', 'utf8')).toContain('ResolvingShareIntentDataParser.kt');
    expect(readFileSync('config/plugins/android-sharing-keep.xml', 'utf8')).toContain('tools:keep="@string/share_into_scheme"');
  });
  it.each(['SimpleShareIntentDataParser.kt', 'ResolvingShareIntentDataParser.kt'])('preserves the installed safety fixes in %s', (name) => {
    const source = readFileSync(`node_modules/expo-sharing/android/src/main/java/expo/modules/sharing/dataParsers/${name}`, 'utf8');
    expect(source).toContain('extractTextPayload(intent) + listOfNotNull(uri?.let');
    expect(source).toContain('uris?.take(10)?.map');
    expect(source).not.toContain('return if (type == "text/plain")');
    if (name.startsWith('Resolving')) {
      expect(source).toContain('File.createTempFile("opencode-share-"');
      expect(source).toContain('total > 10L * 1024 * 1024');
      expect(source).toContain('else "unavailable:"');
      expect(source).not.toContain('File(context.cacheDir, fileName)');
    }
  });
});
