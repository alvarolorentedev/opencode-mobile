import { beforeEach, expect, it, vi } from 'vitest';
import { loadWidgetSnapshot } from '@/features/widgets/services/widget-snapshot-storage';
import { CHAT_PREFERENCES_STORAGE_KEY } from '@/shared/storage/keys';
const storage = vi.hoisted(() => ({ getItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
const snapshot = { updatedAt: 1, showPreviews: true, language: 'en', sessions: [{
  id: 'one', title: 'One', status: 'idle', link: 'opencodemobile://session/one', preview: 'private reply',
}] };
beforeEach(() => { storage.getItem.mockReset(); });
it('honors a newer headless privacy/language preference before rendering an older snapshot', async () => {
  storage.getItem.mockImplementation(async (key) => key === CHAT_PREFERENCES_STORAGE_KEY
    ? JSON.stringify({ showWidgetPreviews: false, language: 'es' }) : JSON.stringify(snapshot));
  const value = await loadWidgetSnapshot();
  expect(value?.showPreviews).toBe(false); expect(value?.sessions[0].preview).toBeUndefined(); expect(value?.language).toBe('es');
});
it('hides excerpts if privacy preferences cannot be read or parsed, and preserves legacy defaults when missing', async () => {
  storage.getItem.mockImplementation(async (key) => { if (key === CHAT_PREFERENCES_STORAGE_KEY) throw new Error('disk unavailable'); return JSON.stringify(snapshot); });
  expect((await loadWidgetSnapshot())?.sessions[0].preview).toBeUndefined();
  storage.getItem.mockImplementation(async (key) => key === CHAT_PREFERENCES_STORAGE_KEY ? '{' : JSON.stringify(snapshot));
  expect((await loadWidgetSnapshot())?.sessions[0].preview).toBeUndefined();
  storage.getItem.mockImplementation(async (key) => key === CHAT_PREFERENCES_STORAGE_KEY ? null : JSON.stringify(snapshot));
  expect((await loadWidgetSnapshot())?.sessions[0].preview).toBe('private reply');
});
