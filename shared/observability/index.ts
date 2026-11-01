import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { setObservabilityTarget } from '@/shared/observability/client';
import { DEFAULT_OBSERVABILITY_PREFERENCES } from '@/shared/observability/config';
import { createObservability } from '@/shared/observability/core';
import { normalizeObservabilityPreferences, preferencesFromChatPreferences } from '@/shared/observability/preferences';
import { CHAT_PREFERENCES_STORAGE_KEY } from '@/shared/storage/keys';
import type { ObservabilitySnapshot } from '@/shared/observability/types';

export type {
  BuildMetadata,
  DiagnosticRecord,
  ExportOptions,
  ExportResult,
  Observability,
  ObservabilityLevel,
  ObservabilityPreferences,
  ObservabilitySnapshot,
  SafeAttributes,
  Span,
} from '@/shared/observability/types';
export { DEFAULT_OBSERVABILITY_PREFERENCES, readBuildMetadata, remoteAvailable } from '@/shared/observability/config';
export { normalizeObservabilityPreferences, preferencesFromChatPreferences } from '@/shared/observability/preferences';

export const observability = createObservability();
setObservabilityTarget(observability);

let initialization: Promise<void> | undefined;

export function initializeObservability() {
  initialization ??= (async () => {
    let preferences = DEFAULT_OBSERVABILITY_PREFERENCES;
    try {
      const raw = await AsyncStorage.getItem(CHAT_PREFERENCES_STORAGE_KEY);
      if (raw) preferences = preferencesFromChatPreferences(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // A malformed preference record keeps the privacy-safe defaults.
    }
    observability.configure(preferences);
    await observability.initialize();
  })();
  return initialization;
}

export function useObservabilitySnapshot(): ObservabilitySnapshot {
  const snapshot = useSyncExternalStore(
    observability.subscribe,
    observability.getSnapshot,
    observability.getSnapshot,
  );
  useEffect(() => {
    void observability.refreshSnapshot();
  }, []);
  return snapshot;
}

export function useObservabilityActions() {
  return {
    refresh: observability.refreshSnapshot,
    clear: observability.clearLocal,
    exportReport: observability.exportReport,
    flush: observability.flush,
  };
}

export { normalizeObservabilityPreferences as normalizePreferences };
