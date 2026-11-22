import { useEffect, useRef, useState } from 'react';

export function useLibraryOperation(visible: boolean, fallbackError: string) {
  const [busy, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const operationRef = useRef<{ id: string } | undefined>(undefined);
  const queuedOpenRef = useRef<{ id: string; action: () => Promise<unknown>; onSuccess: () => void } | undefined>(undefined);
  useEffect(() => () => { operationRef.current = undefined; queuedOpenRef.current = undefined; }, [visible]);

  function reset() {
    operationRef.current = undefined;
    queuedOpenRef.current = undefined;
    setBusyId(undefined);
    setError(undefined);
  }
  async function run(id: string, action: () => Promise<unknown>, onSuccess?: () => void) {
    if (operationRef.current) {
      // Ignore duplicate taps; a different opening waits and the latest wins.
      if (onSuccess && operationRef.current.id !== id) queuedOpenRef.current = { id, action, onSuccess };
      return;
    }
    const operation = { id };
    operationRef.current = operation;
    setBusyId(id); setError(undefined);
    try {
      await action();
      if (operationRef.current === operation && !queuedOpenRef.current) onSuccess?.();
    } catch (reason) {
      if (operationRef.current === operation && !queuedOpenRef.current) setError(reason instanceof Error ? reason.message : fallbackError);
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = undefined; setBusyId(undefined);
        const queued = queuedOpenRef.current;
        queuedOpenRef.current = undefined;
        if (queued) void run(queued.id, queued.action, queued.onSuccess);
      }
    }
  }

  return { busy, error, setError, reset, run };
}
