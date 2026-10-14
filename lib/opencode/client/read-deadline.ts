export const READ_TIMEOUT_MS = 30_000;

// SDKs consume bodies after fetch resolves. Keep the same deadline through that
// consumption, and reject even if a native transport ignores cancellation.
export async function fetchWithReadDeadline(fetcher: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const upstream = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
  let reject!: (reason: Error) => void;
  const deadline = new Promise<never>((_, fail) => { reject = fail; });
  const abort = () => { reject(new Error('OpenCode read canceled.')); controller.abort(); cleanup(); };
  const timer = setTimeout(() => {
    reject(new Error('OpenCode read timed out after 30 seconds.'));
    controller.abort();
    cleanup();
  }, READ_TIMEOUT_MS);
  const cleanup = () => { clearTimeout(timer); upstream?.removeEventListener('abort', abort); };
  upstream?.addEventListener('abort', abort, { once: true });
  if (upstream?.aborted) abort();
  // A response may be inspected without consuming its body.
  void deadline.catch(() => undefined);
  const wrap = (response: Response, original = true): Response => new Proxy(response, {
    get(target, property) {
      if (property === 'clone') return () => wrap(target.clone(), false);
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (['json', 'text', 'arrayBuffer', 'blob', 'formData', 'bytes'].includes(String(property))) {
        return (...args: unknown[]) => Promise.race([Promise.resolve().then(() => value.apply(target, args)), deadline]).finally(() => { if (original) cleanup(); });
      }
      return value.bind(target);
    },
  });
  try {
    const response = await Promise.race([fetcher(input, { ...init, signal: controller.signal }), deadline]);
    if (!response.body || response.status === 204 || response.status === 304) cleanup();
    return wrap(response);
  } catch (error) { cleanup(); throw error; }
}
