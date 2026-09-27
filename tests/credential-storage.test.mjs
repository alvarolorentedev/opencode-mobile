import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Static guardrails for the credential split: profile metadata, favorites,
// session caches, last-session maps, and pending notifications live in
// AsyncStorage, while every password goes through SecureStore. The functional
// behavior is covered by tests/connection-profiles.test.mjs,
// tests/notifications.test.mjs, and tests/favorites.test.mjs.

const persistence = await readFile(new URL('../providers/use-opencode-persistence.ts', import.meta.url), 'utf8');
const notifications = await readFile(new URL('../lib/notifications.ts', import.meta.url), 'utf8');
const pending = await readFile(new URL('../lib/notification-pending.ts', import.meta.url), 'utf8');
const profiles = await readFile(new URL('../lib/connection-profiles.ts', import.meta.url), 'utf8');
const favorites = await readFile(new URL('../providers/favorites-storage.ts', import.meta.url), 'utf8');
const passwordStorage = await readFile(new URL('../lib/connection-password.ts', import.meta.url), 'utf8');

// Persisted settings strip the password; the password is saved to SecureStore.
assert.match(persistence, /withoutConnectionPassword\(settings\)/);
assert.match(persistence, /saveConnectionPassword\(settings\.password\)/);

// Legacy plaintext settings are migrated to SecureStore and stripped.
assert.match(passwordStorage, /await SecureStore\.setItemAsync\(CONNECTION_PASSWORD_STORAGE_KEY, legacyPassword\)/);
assert.match(passwordStorage, /await AsyncStorage\.setItem\(SETTINGS_STORAGE_KEY, JSON\.stringify\(storedSettings\)\)/);

// Profile passwords use their own SecureStore key, never AsyncStorage.
assert.match(profiles, /SecureStore\.setItemAsync\(passwordKey\(profileId\), password\)/);
assert.match(profiles, /SecureStore\.deleteItemAsync\(passwordKey\(profileId\)\)/);
assert.doesNotMatch(profiles, /AsyncStorage\.setItem\(passwordKey/);

// Pending notification records resolve credentials for the connection that
// created them instead of reading the active connection password directly, and
// persisted writes go through the explicit non-secret serializer.
assert.match(notifications, /resolveConnectionPassword\(/);
assert.doesNotMatch(notifications, /getConnectionPassword/);
assert.doesNotMatch(notifications, /Pick<OpencodeConnectionSettings, 'serverUrl' \| 'username' \| 'password'>/);
assert.match(notifications, /serializePendingNotificationSessions\(value\)/);
assert.match(pending, /connectionScope: scope/);
assert.match(pending, /settings: \{ serverUrl, username \}/);
assert.doesNotMatch(pending, /password:/);

// Favorites keep only the explicit non-secret model.
assert.doesNotMatch(favorites, /password/i);

console.log('credential storage tests passed');
