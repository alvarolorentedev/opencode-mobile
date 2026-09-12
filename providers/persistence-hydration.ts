export type PersistenceStorage = Pick<typeof import('@react-native-async-storage/async-storage').default, 'getItem' | 'removeItem'>;

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
    return;
  }

  if (raw === null) {
    return;
  }

  let value: T;
  try {
    value = parse(raw);
  } catch {
    await storage.removeItem(key).catch(() => undefined);
    return;
  }

  try {
    apply(value);
  } catch {
    // State updates are independent from storage validity.
  }
}
