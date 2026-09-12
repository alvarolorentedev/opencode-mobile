import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const persistence = await readFile(new URL('../providers/use-opencode-persistence.ts', import.meta.url), 'utf8');
const notifications = await readFile(new URL('../lib/notifications.ts', import.meta.url), 'utf8');

assert.match(persistence, /withoutConnectionPassword\(settings\)/);
assert.match(persistence, /saveConnectionPassword\(settings\.password\)/);
const passwordStorage = await readFile(new URL('../lib/connection-password.ts', import.meta.url), 'utf8');
assert.match(passwordStorage, /await SecureStore\.setItemAsync\(CONNECTION_PASSWORD_STORAGE_KEY, legacyPassword\)/);
assert.match(passwordStorage, /await AsyncStorage\.setItem\(SETTINGS_STORAGE_KEY, JSON\.stringify\(storedSettings\)\)/);
assert.doesNotMatch(notifications, /Pick<OpencodeConnectionSettings, 'serverUrl' \| 'username' \| 'password'>/);
assert.match(notifications, /password: await getConnectionPassword\(\)/);
assert.match(notifications, /isCurrentPendingConnection\(pending\)/);
assert.match(notifications, /withoutPendingPassword\(value\)/);

console.log('credential storage tests passed');
