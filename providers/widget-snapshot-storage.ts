import AsyncStorage from '@react-native-async-storage/async-storage';

import { WIDGET_SNAPSHOT_STORAGE_KEY } from '@/lib/storage-keys';
import { parseWidgetSnapshot, type WidgetSnapshot } from '@/providers/widget-snapshot';

// One bounded snapshot under one key. Writes come only from confirmed provider
// state (providers/use-native-surfaces.ts); the Android widget's headless task
// reads it because it cannot run inside the provider. Malformed or unreadable
// values render the widget's empty state instead of failing the task.
export async function loadWidgetSnapshot(): Promise<WidgetSnapshot | undefined> {
  try {
    const raw = await AsyncStorage.getItem(WIDGET_SNAPSHOT_STORAGE_KEY);
    if (!raw) return undefined;
    return parseWidgetSnapshot(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export async function saveWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(WIDGET_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('Could not save the widget snapshot.', error);
  }
}
