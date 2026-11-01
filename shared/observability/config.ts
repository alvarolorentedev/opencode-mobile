import { base64 } from '@scure/base';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { BuildMetadata, ObservabilityPreferences } from '@/shared/observability/types';

export const SERVICE_NAME = 'opencode-mobile';
export const OBSERVABILITY_SCHEMA_VERSION = 1;

export const DEFAULT_OBSERVABILITY_PREFERENCES: ObservabilityPreferences = {
  diagnosticsEnabled: true,
  diagnosticsLevel: 'normal',
  remoteTelemetryEnabled: true,
  remoteCrashReports: true,
  remotePerformance: true,
};

export type RemoteOtlpConfig = {
  endpoint: string;
  authorization: string;
  environment: string;
};

// Expo/Metro inlines `EXPO_PUBLIC_*` only for static member expressions. Do not
// replace these with a dynamic env(name) helper or they disappear from bundles.
function publicOtlpEndpoint() { return process.env.EXPO_PUBLIC_GRAFANA_OTLP_ENDPOINT; }
function publicOtlpInstanceId() { return process.env.EXPO_PUBLIC_GRAFANA_OTLP_INSTANCE_ID; }
function publicOtlpToken() { return process.env.EXPO_PUBLIC_GRAFANA_OTLP_TOKEN; }
function publicObservabilityEnvironment() { return process.env.EXPO_PUBLIC_OBSERVABILITY_ENVIRONMENT; }
function publicFoss() { return process.env.EXPO_PUBLIC_FOSS; }
function publicE2eMode() { return process.env.EXPO_PUBLIC_E2E_MODE; }

function env(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function newSessionId() {
  let value = '';
  for (let index = 0; index < 8; index += 1) {
    value += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return value;
}

function appVariant() {
  const extra = Constants.expoConfig?.extra as { foss?: unknown } | undefined;
  if (extra?.foss === true || publicFoss() === '1') return 'foss' as const;
  if (publicE2eMode() === '1' || env('EXPO_APP_VARIANT') === 'development') return 'development' as const;
  return 'production' as const;
}

export function readBuildMetadata(): BuildMetadata {
  const config = Constants.expoConfig;
  const platform = Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web' ? Platform.OS : 'unknown';
  return {
    appVersion: config?.version ?? '0.0.0',
    buildNumber: String(config?.android?.versionCode ?? config?.ios?.buildNumber ?? '0'),
    platform,
    osVersion: typeof Platform.Version === 'string' || typeof Platform.Version === 'number' ? String(Platform.Version) : undefined,
    variant: appVariant(),
    environment: publicObservabilityEnvironment()?.trim() || (appVariant() === 'production' ? 'production' : 'development'),
    sessionId: newSessionId(),
  };
}

export function readRemoteOtlpConfig(): RemoteOtlpConfig | undefined {
  const build = readBuildMetadata();
  // FOSS ships local diagnostics only; remote export is intentionally disabled
  // there regardless of build environment. E2E builds never contact Grafana.
  if (build.variant === 'foss' || publicE2eMode() === '1') return undefined;
  const endpoint = publicOtlpEndpoint()?.trim().replace(/\/+$/, '');
  const instanceId = publicOtlpInstanceId()?.trim();
  const token = publicOtlpToken()?.trim();
  if (!endpoint || !instanceId || !token) return undefined;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  // Credentials must never travel over cleartext. A local collector can opt in
  // with an explicit localhost endpoint, which is useful for development.
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) return undefined;
  return {
    endpoint,
    authorization: `Basic ${base64.encode(new TextEncoder().encode(`${instanceId}:${token}`))}`,
    environment: publicObservabilityEnvironment()?.trim() || build.environment,
  };
}

export function remoteAvailable() {
  return Boolean(readRemoteOtlpConfig());
}
