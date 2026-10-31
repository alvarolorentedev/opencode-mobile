// Share only outstanding reads. Settled results are never cached, and separate
// scoped clients never share work (including after a connection switch).
const requests = new WeakMap<object, Map<string, Promise<unknown>>>();

export function coalesceRead<T>(client: object, key: string, read: () => Promise<T>): Promise<T> {
  let pending = requests.get(client);
  if (!pending) {
    pending = new Map();
    requests.set(client, pending);
  }
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const result = Promise.resolve().then(read).finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}
