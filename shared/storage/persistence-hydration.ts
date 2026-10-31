export type PersistenceStorage = Pick<typeof import('@react-native-async-storage/async-storage').default, 'getItem' | 'removeItem'>;

// Per-key ordering also protects SecureStore transitions. Failed writes remain
// retryable; only successful values can suppress an unchanged write.
export function createPersistenceWriter() {
  const saved = new Map<string, string | null>();
  const pending = new Map<string, Promise<unknown>>();
  const unread = new Map<string, string | null | undefined>();
  const writeValue = (key: string, value: string | null, write: () => Promise<unknown>) => {
    if (unread.has(key)) {
      if (unread.get(key) === undefined) unread.set(key, value);
      if (unread.get(key) === value) return Promise.resolve();
      unread.delete(key);
    }
    const result = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (saved.has(key) && saved.get(key) === value) return;
      await write();
      saved.set(key, value);
    });
    pending.set(key, result);
    void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => undefined);
    return result;
  };
  return Object.assign(writeValue, { preserveUnread: (key: string) => { unread.set(key, undefined); } });
}

export async function loadPersistedValue<T>(
  storage: PersistenceStorage,
  key: string,
  parse: (raw: string) => T,
  apply: (value: T) => void,
) {
  let raw: string | null;

  try {
    raw = await storage.getItem(key);
  } catch {
    return false;
  }

  if (raw === null) {
    return true;
  }

  let value: T;
  try {
    value = parse(raw);
  } catch {
    await storage.removeItem(key).catch(() => undefined);
    return true;
  }

  try {
    apply(value);
  } catch {
    // State updates are independent from storage validity.
  }
  return true;
}
