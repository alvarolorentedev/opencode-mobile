import AsyncStorage from '@react-native-async-storage/async-storage';

import { CHAT_PREFERENCES_STORAGE_KEY, WIDGET_SNAPSHOT_STORAGE_KEY } from '@/shared/storage/keys';
import { hideWidgetPreviews, parseWidgetSnapshot } from '@/features/widgets/model/widget-snapshot';
import type { WidgetSnapshot } from '@/shared/contracts/widget-snapshot';

// One bounded snapshot under one key. Writes come only from confirmed provider
// state (features/widgets/state/use-widget-state.ts); the Android widget's headless task
// reads it because it cannot run inside the provider. Malformed or unreadable
// values render the widget's empty state instead of failing the task.
export async function loadWidgetSnapshot(): Promise<WidgetSnapshot | undefined> {
  try {
    const raw = await AsyncStorage.getItem(WIDGET_SNAPSHOT_STORAGE_KEY);
    if (!raw) return undefined;
    const snapshot = parseWidgetSnapshot(JSON.parse(raw));
    if (!snapshot) return undefined;
    // Headless tasks must honor a newer privacy preference than their snapshot.
    try {
      const rawPreferences = await AsyncStorage.getItem(CHAT_PREFERENCES_STORAGE_KEY);
      if (!rawPreferences) return snapshot;
      const preferences = JSON.parse(rawPreferences);
      if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return hideWidgetPreviews(snapshot);
      const next = { ...snapshot, language: typeof preferences.language === 'string' ? preferences.language.slice(0, 32) : undefined };
      return preferences.showWidgetPreviews === false ? hideWidgetPreviews(next) : next;
    } catch {
      return hideWidgetPreviews(snapshot);
    }
  } catch {
    return undefined;
  }
}

export async function saveWidgetSnapshot(snapshot: WidgetSnapshot): Promise<boolean> {
  try {
    await AsyncStorage.setItem(WIDGET_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch (error) {
    console.warn('Could not save the widget snapshot.', error);
    return false;
  }
}
