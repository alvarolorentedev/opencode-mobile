import { afterEach, describe, expect, it, vi } from 'vitest';

import { readRemoteOtlpConfig } from '@/shared/observability/config';

const { expoConfig } = vi.hoisted(() => ({
  expoConfig: { version: '1.0.0', android: { versionCode: 1 }, extra: { foss: false } as { foss?: boolean } },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: '14' } }));

describe('remote observability build gate', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_GRAFANA_OTLP_ENDPOINT;
    delete process.env.EXPO_PUBLIC_GRAFANA_OTLP_INSTANCE_ID;
    delete process.env.EXPO_PUBLIC_GRAFANA_OTLP_TOKEN;
    delete process.env.EXPO_PUBLIC_FOSS;
    expoConfig.extra.foss = false;
  });

  it('is unavailable in FOSS builds even when credentials are present', () => {
    process.env.EXPO_PUBLIC_GRAFANA_OTLP_ENDPOINT = 'https://otlp.example.test/otlp';
    process.env.EXPO_PUBLIC_GRAFANA_OTLP_INSTANCE_ID = '123';
    process.env.EXPO_PUBLIC_GRAFANA_OTLP_TOKEN = 'secret';
    expoConfig.extra.foss = true;
    expect(readRemoteOtlpConfig()).toBeUndefined();
  });

  it('is unavailable without credentials and accepts a scoped https endpoint', () => {
    expect(readRemoteOtlpConfig()).toBeUndefined();
    process.env.EXPO_PUBLIC_GRAFANA_OTLP_ENDPOINT = 'https://otlp.example.test/otlp';
    process.env.EXPO_PUBLIC_GRAFANA_OTLP_INSTANCE_ID = '123';
    process.env.EXPO_PUBLIC_GRAFANA_OTLP_TOKEN = 'secret';
    const config = readRemoteOtlpConfig();
    expect(config?.endpoint).toBe('https://otlp.example.test/otlp');
    expect(config?.authorization).toMatch(/^Basic /);
    expect(config?.environment).toBe('production');
  });

  it('rejects cleartext non-local endpoints', () => {
    process.env.EXPO_PUBLIC_GRAFANA_OTLP_ENDPOINT = 'http://otlp.example.test/otlp';
    process.env.EXPO_PUBLIC_GRAFANA_OTLP_INSTANCE_ID = '123';
    process.env.EXPO_PUBLIC_GRAFANA_OTLP_TOKEN = 'secret';
    expect(readRemoteOtlpConfig()).toBeUndefined();
  });
});
