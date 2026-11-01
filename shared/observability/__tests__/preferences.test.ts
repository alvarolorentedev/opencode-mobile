import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_OBSERVABILITY_PREFERENCES } from '@/shared/observability/config';
import { normalizeObservabilityPreferences } from '@/shared/observability/preferences';

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.0', extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: '14' } }));

describe('observability preferences', () => {
  it('enables local recording and remote telemetry by default', () => {
    expect(normalizeObservabilityPreferences(undefined)).toEqual(DEFAULT_OBSERVABILITY_PREFERENCES);
    expect(normalizeObservabilityPreferences({})).toEqual(DEFAULT_OBSERVABILITY_PREFERENCES);
    expect(DEFAULT_OBSERVABILITY_PREFERENCES.remoteTelemetryEnabled).toBe(true);
  });

  it('preserves explicit opt-outs and ignores malformed values', () => {
    expect(normalizeObservabilityPreferences({
      diagnosticsEnabled: false,
      diagnosticsLevel: 'verbose',
      remoteTelemetryEnabled: false,
      remoteCrashReports: false,
      remotePerformance: 'yes',
    })).toEqual({
      diagnosticsEnabled: false,
      diagnosticsLevel: 'verbose',
      remoteTelemetryEnabled: false,
      remoteCrashReports: false,
      remotePerformance: true,
    });
  });
});
