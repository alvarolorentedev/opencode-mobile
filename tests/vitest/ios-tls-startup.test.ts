import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('../../modules/opencode-tls/ios/OpencodeTlsModule.swift', import.meta.url), 'utf8');

describe('iOS TLS module startup', () => {
  it('synchronously installs the main-actor Expo fetch provider on the main thread', () => {
    const setter = fs.readFileSync(new URL('../../node_modules/expo/ios/Expo/Fetch/ExpoFetchCustomExtension.swift', import.meta.url), 'utf8');
    expect(setter).toMatch(/@MainActor\s+@objc\s+public static func setCustomURLSessionConfigurationProvider/);
    const installer = source.slice(source.indexOf('private static func installExpoFetchProvider()'));
    expect(installer).toMatch(/guard Thread\.isMainThread else\s*\{\s*DispatchQueue\.main\.sync\s*\{ installExpoFetchProvider\(\) \}\s*return\s*\}/);
    expect(installer.indexOf('guard Thread.isMainThread')).toBeLessThan(installer.indexOf('method_getImplementation'));
    expect(installer).not.toMatch(/DispatchQueue\.main\.async|Task\s*\{/);
    // Configuration callbacks remain nonisolated for RN/Expo network callers.
    expect(source).not.toMatch(/^\s*@MainActor\b/m);
  });

  it('preserves all three transport hooks and scoped certificate validation', () => {
    expect(source).toMatch(/OnCreate\s*\{\s*Self\.installURLSessionProvider\(\)\s*Self\.installExpoFetchProvider\(\)\s*OpencodeTlsWebSocketInstaller\.install\(\)/);
    expect(source).toContain('protocols.insert(OpencodeTlsURLProtocol.self, at: 0)');
    expect(source).toContain('TrustStore.set(origin: origin, pems: pems)');
    expect(source).toContain('OpencodeTlsTrust.setAnchors(TrustStore.certificates(for: origin) as [Any], forOrigin: origin)');
  });
});
