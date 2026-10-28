import { useCallback, useEffect, useState } from 'react';

import { releaseLocalAutoModelRuntime } from '@/lib/auto-model/runtime';
import {
  getLocalAutoModelBytes,
  getLocalAutoModelError,
  getLocalAutoModelStatus,
  installLocalAutoModel,
  removeLocalAutoModel,
  type LocalAutoModelStatus,
} from '@/lib/auto-model/models';

export function useAutoModelSetup(refreshAvailability: () => void) {
  const [status, setStatus] = useState<LocalAutoModelStatus>(() => getLocalAutoModelStatus());
  const [error, setError] = useState<string | undefined>(() => getLocalAutoModelError());
  const [bytes, setBytes] = useState(() => getLocalAutoModelBytes());

  useEffect(() => {
    refreshAvailability();
  }, [refreshAvailability]);

  useEffect(() => {
    if (status !== 'installing') {
      return;
    }
    const timer = setInterval(() => {
      const next = getLocalAutoModelStatus();
      setStatus(next);
      setBytes(getLocalAutoModelBytes());
      if (next !== 'installing') {
        setError(getLocalAutoModelError());
        refreshAvailability();
      }
    }, 500);
    return () => clearInterval(timer);
  }, [refreshAvailability, status]);

  const install = useCallback(async () => {
    setError(undefined);
    setStatus('installing');
    try {
      await installLocalAutoModel();
      setStatus(getLocalAutoModelStatus());
      setBytes(getLocalAutoModelBytes());
      refreshAvailability();
    } catch (reason) {
      setStatus('error');
      setError(reason instanceof Error ? reason.message : 'Could not install the classifier model.');
    }
  }, [refreshAvailability]);

  const remove = useCallback(async () => {
    await releaseLocalAutoModelRuntime();
    await removeLocalAutoModel();
    setStatus(getLocalAutoModelStatus());
    setBytes(0);
    setError(undefined);
    refreshAvailability();
  }, [refreshAvailability]);

  return { status, error, bytes, install, remove };
}
