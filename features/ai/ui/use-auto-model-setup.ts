import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { releaseLocalAutoModelRuntime } from '@/features/ai/model/auto-model/runtime';
import { getLocalAutoModelBytes, getLocalAutoModelError, getLocalAutoModelStatus, installLocalAutoModel, removeLocalAutoModel, type LocalAutoModelStatus } from '@/features/ai/model/auto-model/models';
import { modelDownloadErrorCode, modelDownloadMessageKeyForCode, type ModelInstallErrorCode } from '@/shared/platform/models/model-download';

export function useAutoModelSetup(refreshAvailability: () => void) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LocalAutoModelStatus>(() => getLocalAutoModelStatus());
  const [errorCode, setErrorCode] = useState<ModelInstallErrorCode | undefined>(() => getLocalAutoModelError());
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
        setErrorCode(getLocalAutoModelError());
        refreshAvailability();
      }
    }, 500);
    return () => clearInterval(timer);
  }, [refreshAvailability, status]);

  const install = useCallback(async () => {
    setErrorCode(undefined);
    setStatus('installing');
    try {
      await installLocalAutoModel();
      setStatus(getLocalAutoModelStatus());
      setBytes(getLocalAutoModelBytes());
      setErrorCode(undefined);
      refreshAvailability();
    } catch (reason) {
      setStatus('error');
      setErrorCode(modelDownloadErrorCode(reason));
    }
  }, [refreshAvailability]);

  const remove = useCallback(async () => {
    await releaseLocalAutoModelRuntime();
    await removeLocalAutoModel();
    setStatus(getLocalAutoModelStatus());
    setBytes(0);
    setErrorCode(undefined);
    refreshAvailability();
  }, [refreshAvailability]);

  const error = errorCode ? t(modelDownloadMessageKeyForCode(errorCode)) : undefined;

  return { status, error, bytes, install, remove };
}
