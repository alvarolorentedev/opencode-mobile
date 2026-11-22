import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AppStore } from '@/runtime/core/store';
import type { ConnectionHeaders } from '@/shared/contracts/connection-headers';
import { isValidServerUrl } from '@/shared/contracts/server-url';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { getConnectionHeaders, saveConnectionHeaders } from '@/shared/storage/connection-headers';
import { getConnectionPassword, saveConnectionPassword, withoutConnectionSecrets } from '@/shared/storage/connection-password';
import { SETTINGS_STORAGE_KEY } from '@/shared/storage/keys';
import { createPersistenceWriter, loadPersistedValue } from '@/shared/storage/persistence-hydration';
import { parseConnectionSettings } from '@/shared/storage/persisted-preferences';

const secureStorage = { getConnectionPassword, saveConnectionPassword, getConnectionHeaders, saveConnectionHeaders };

export function createConnectionSettingsPersistence(
  storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'> = AsyncStorage,
  secrets = secureStorage,
) {
  const write = createPersistenceWriter();
  async function hydrate(defaults: OpencodeConnectionSettings) {
    let persisted: Partial<OpencodeConnectionSettings> | undefined;
    const read = await loadPersistedValue(storage, SETTINGS_STORAGE_KEY, parseConnectionSettings, (settings) => { persisted = settings; });
    if (!read) write.preserveUnread(SETTINGS_STORAGE_KEY);

    const hasIdentity = Boolean(persisted?.serverUrl && isValidServerUrl(persisted.serverUrl));
    const legacyPassword = hasIdentity ? persisted?.password ?? '' : '';
    let password = legacyPassword;
    let headers: ConnectionHeaders = {};
    if (hasIdentity) {
      try {
        if (persisted && 'password' in persisted) {
          await secrets.saveConnectionPassword(legacyPassword);
          await storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(withoutConnectionSecrets({ ...defaults, ...persisted })));
        }
        password = (await secrets.getConnectionPassword()) || legacyPassword;
      } catch (error) {
        write.preserveUnread(SETTINGS_STORAGE_KEY);
        console.warn('Could not hydrate connection credentials.', error);
      }
      try {
        headers = await secrets.getConnectionHeaders();
      } catch (error) {
        console.warn('Could not hydrate connection headers.', error);
      }
    }
    return { ...defaults, ...persisted, password, headers };
  }

  function persist(settings: OpencodeConnectionSettings) {
    const metadata = JSON.stringify(withoutConnectionSecrets(settings));
    const credential = JSON.stringify([settings.password, Boolean(settings.connect)]);
    const headerValue = JSON.stringify(settings.headers ?? {});
    return write(SETTINGS_STORAGE_KEY, JSON.stringify([metadata, credential, headerValue]), async () => {
      await write('connection-password', credential, () => secrets.saveConnectionPassword(settings.password, Boolean(settings.connect)));
      await write('connection-headers', headerValue, () => secrets.saveConnectionHeaders(settings.headers));
      await storage.setItem(SETTINGS_STORAGE_KEY, metadata);
    });
  }

  function observe(store: AppStore) {
    const persistSettings = (settings: OpencodeConnectionSettings) => {
      void persist(settings).catch((error) => console.warn('Could not save connection settings.', error));
    };
    persistSettings(store.getState().shell.settings);
    return store.subscribe(({ shell }, previous) => {
      if (shell.settings !== previous.shell.settings) persistSettings(shell.settings);
    });
  }

  return { hydrate, persist, observe };
}
