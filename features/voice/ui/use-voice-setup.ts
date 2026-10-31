import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { modelDownloadErrorMessageKey } from '@/shared/platform/models/model-download';
import { getVoiceCapabilitiesAsync, type VoiceCapabilities } from '@/shared/platform/voice/capabilities';
import { getLocalCommandModelStatus, getLocalVoiceBaseStatus, getLocalVoiceModelStatus, installLocalVoiceModels, removeLocalVoiceModels } from '@/shared/platform/voice/local-wake-word/models';
import { releaseLocalVoiceRuntime } from '@/shared/platform/voice/local-wake-word/runtime';
import type { LocalCommandModelId, LocalWakePhraseId, LocalVoiceModelStatus } from '@/shared/platform/voice/local-wake-word/types';
import { getLocalVoicePermissionAsync, requestLocalVoicePermissionAsync, openVoiceSettingsAsync, requestVoiceInputPermissionAsync } from '@/shared/platform/voice/permissions';
import type { SpeechPlayback } from '@/shared/platform/voice/speech-types';
import { speakText, stopSpeaking } from '@/shared/platform/voice/speech-output';
import { useLocalVoiceEnrollment } from '@/shared/platform/voice/use-local-voice-enrollment';

/**
 * Voice permission + capability + playback-test controller shared by the
 * Settings voice check and the onboarding permissions step.
 *
 * `refreshStatus()` is read-only. Permission is only requested from `enable()`.
 * The playback test exercises the real TTS path so a stale voice id surfaces
 * here instead of silently failing inside conversation mode.
 */
export function useVoiceSetup({
  locale,
  localCommandModel,
  localWakePhrase,
  playback,
  rate,
}: {
  locale?: string;
  localCommandModel: LocalCommandModelId;
  localWakePhrase: LocalWakePhraseId;
  playback: SpeechPlayback;
  rate: number;
}) {
  const { t } = useTranslation();
  const [capabilities, setCapabilities] = useState<VoiceCapabilities>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [localVoiceStatus, setLocalVoiceStatus] = useState<LocalVoiceModelStatus>('missing');
  const [localVoiceBaseStatus, setLocalVoiceBaseStatus] = useState<LocalVoiceModelStatus>('missing');
  const [localVoiceCommandStatus, setLocalVoiceCommandStatus] = useState<LocalVoiceModelStatus>('missing');
  const [isInstallingLocalVoice, setIsInstallingLocalVoice] = useState(false);
  const [localVoiceError, setLocalVoiceError] = useState<string>();
  const enrollment = useLocalVoiceEnrollment();
  const [microphone, setMicrophone] = useState<{ granted: boolean; canAskAgain: boolean }>();
  const refreshMicrophone = useCallback(async () => {
    try { setMicrophone(await getLocalVoicePermissionAsync()); } catch { setMicrophone({ granted: false, canAskAgain: false }); }
  }, []);
  const enableMicrophone = useCallback(async () => {
    try { setMicrophone(await requestLocalVoicePermissionAsync()); } catch { setMicrophone({ granted: false, canAskAgain: false }); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read native microphone permission on mount without prompting.
    void refreshMicrophone();
  }, [refreshMicrophone]);

  const refreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setCapabilities(await getVoiceCapabilitiesAsync());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const enable = useCallback(async () => {
    setFeedback(undefined);
    await requestVoiceInputPermissionAsync();
    await refreshStatus();
  }, [refreshStatus]);

  const openAppSettings = useCallback(async () => {
    await openVoiceSettingsAsync();
  }, []);

  const testPlayback = useCallback(async () => {
    setIsTesting(true);
    setFeedback(undefined);
    try {
      const started = await speakText({
        language: locale,
        onDone: () => setFeedback(undefined),
        onEngineFallback: () => setFeedback(t('settings:voice.localTts.fallbackToSystem')),
        onError: () => setFeedback(t('settings:voice.check.testFailed')),
        playback,
        rate,
        text: t('settings:voice.check.testPhrase'),
      });
      if (!started) {
        setFeedback(t('settings:voice.check.testFailed'));
      }
    } finally {
      setIsTesting(false);
    }
  }, [locale, playback, rate, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate voice status once on mount.
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    // Voice permissions and installed engines can change in system settings
    // while the app is backgrounded. Re-read them on resume instead of
    // exposing a manual re-check action.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshStatus();
      void refreshMicrophone();
    });
    return () => subscription.remove();
  }, [refreshMicrophone, refreshStatus]);

  const refreshLocalVoiceStatus = useCallback(() => {
    setLocalVoiceBaseStatus(getLocalVoiceBaseStatus());
    setLocalVoiceCommandStatus(getLocalCommandModelStatus(localCommandModel));
    setLocalVoiceStatus(getLocalVoiceModelStatus(localCommandModel));
  }, [localCommandModel]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate on-device voice status once on mount.
    refreshLocalVoiceStatus();
  }, [refreshLocalVoiceStatus]);

  const installLocalVoice = useCallback(async () => {
    setIsInstallingLocalVoice(true);
    setLocalVoiceError(undefined);
    setLocalVoiceStatus('installing');
    try {
      await installLocalVoiceModels(localWakePhrase, localCommandModel);
      refreshLocalVoiceStatus();
      return true;
    } catch (error) {
      refreshLocalVoiceStatus();
      setLocalVoiceStatus('error');
      setLocalVoiceError(t(modelDownloadErrorMessageKey(error)));
      return false;
    } finally {
      setIsInstallingLocalVoice(false);
    }
  }, [localCommandModel, localWakePhrase, refreshLocalVoiceStatus, t]);

  const removeLocalVoice = useCallback(async () => {
    setLocalVoiceError(undefined);
    try {
      await releaseLocalVoiceRuntime();
      await removeLocalVoiceModels();
      refreshLocalVoiceStatus();
    } catch (error) {
      setLocalVoiceStatus('error');
      setLocalVoiceError(error instanceof Error ? error.message : 'Could not remove the on-device voice models.');
    }
  }, [refreshLocalVoiceStatus]);

  useEffect(
    () => () => {
      void stopSpeaking().catch(() => undefined);
    },
    [],
  );

  return {
    capabilities,
    clearFeedback: useCallback(() => setFeedback(undefined), []),
    enable,
    feedback,
    isRefreshing,
    isTesting,
    localVoice: {
      baseStatus: localVoiceBaseStatus,
      microphone,
      enableMicrophone,
      refreshMicrophone,
      clearError: useCallback(() => setLocalVoiceError(undefined), []),
      commandStatus: localVoiceCommandStatus,
      enrollment,
      error: localVoiceError,
      install: installLocalVoice,
      isInstalling: isInstallingLocalVoice,
      refresh: refreshLocalVoiceStatus,
      remove: removeLocalVoice,
      status: localVoiceStatus,
    },
    openAppSettings,
    refreshStatus,
    testPlayback,
  };
}

export type LocalVoiceState = ReturnType<typeof useVoiceSetup>['localVoice'];
