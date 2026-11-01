import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
};

describe('observability dependency boundary', () => {
  it('uses the OpenTelemetry SDK for traces, metrics and logs', () => {
    expect(pkg.dependencies?.['@opentelemetry/api']).toBe('1.9.0');
    expect(pkg.dependencies?.['@opentelemetry/api-logs']).toBe('0.223.0');
    expect(pkg.dependencies?.['@opentelemetry/sdk-trace']).toBe('2.12.0');
    expect(pkg.dependencies?.['@opentelemetry/sdk-metrics']).toBe('2.12.0');
    expect(pkg.dependencies?.['@opentelemetry/sdk-logs']).toBe('0.223.0');
    expect(pkg.dependencies?.fflate).toBe('0.8.3');
  });

  it('does not ship a native telemetry SDK or a custom logger runtime', () => {
    expect(pkg.dependencies?.['@sentry/react-native']).toBeUndefined();
    expect(pkg.dependencies?.['expo-observe']).toBeUndefined();
    expect(pkg.dependencies?.['@grafana/faro-react-native']).toBeUndefined();
    expect(pkg.dependencies?.['react-native-logs']).toBeUndefined();
  });
});
