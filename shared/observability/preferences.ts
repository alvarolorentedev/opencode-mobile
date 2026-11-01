import { DEFAULT_OBSERVABILITY_PREFERENCES } from '@/shared/observability/config';
import type { ObservabilityPreferences } from '@/shared/observability/types';

export function normalizeObservabilityPreferences(value: unknown): ObservabilityPreferences {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    diagnosticsEnabled: typeof record.diagnosticsEnabled === 'boolean'
      ? record.diagnosticsEnabled
      : DEFAULT_OBSERVABILITY_PREFERENCES.diagnosticsEnabled,
    diagnosticsLevel: record.diagnosticsLevel === 'verbose' ? 'verbose' : 'normal',
    remoteTelemetryEnabled: typeof record.remoteTelemetryEnabled === 'boolean'
      ? record.remoteTelemetryEnabled
      : DEFAULT_OBSERVABILITY_PREFERENCES.remoteTelemetryEnabled,
    remoteCrashReports: record.remoteCrashReports !== false,
    remotePerformance: record.remotePerformance !== false,
  };
}

export function preferencesFromChatPreferences(value: {
  diagnosticsEnabled?: unknown;
  diagnosticsLevel?: unknown;
  remoteTelemetryEnabled?: unknown;
  remoteCrashReports?: unknown;
  remotePerformance?: unknown;
}) {
  return normalizeObservabilityPreferences(value);
}
