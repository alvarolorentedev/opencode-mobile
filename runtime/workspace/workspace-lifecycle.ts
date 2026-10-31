// Wait for committed publications, never for a polling interval.
export function createWorkspaceWaiters() {
  const listeners = new Set<() => void>();
  let disposed = false;
  return {
    resume() { disposed = false; },
    notify() { for (const listener of [...listeners]) listener(); },
    dispose() { disposed = true; for (const listener of [...listeners]) listener(); },
    wait<T>(read: () => T | undefined, signal?: AbortSignal, timeout = 20_000): Promise<T> {
      return new Promise((resolve, reject) => {
        const finish = (value?: T, error?: unknown) => {
          clearTimeout(timer); listeners.delete(check); signal?.removeEventListener('abort', check);
          if (error) reject(error); else resolve(value!);
        };
        const check = () => {
          try {
            if (disposed || signal?.aborted) throw new Error('This navigation was cancelled.');
            const value = read();
            if (value !== undefined) finish(value);
          } catch (error) { finish(undefined, error); }
        };
        const timer = setTimeout(() => finish(undefined, new Error('Could not open this workspace.')), timeout);
        listeners.add(check); signal?.addEventListener('abort', check, { once: true }); check();
      });
    },
  };
}
