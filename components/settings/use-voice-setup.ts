import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getVoiceCapabilitiesAsync, type VoiceCapabilities } from '@/lib/voice/capabilities';
import {
  getLocalVoiceModelStatus,
  installLocalVoiceModels,
  removeLocalVoiceModels,
} from '@/lib/voice/local-wake-word/models';
import { releaseLocalVoiceRuntime } from '@/lib/voice/local-wake-word/runtime';
import type { LocalCommandModelId, LocalWakePhraseId, LocalVoiceModelStatus } from '@/lib/voice/local-wake-word/types';
import { openVoiceSettingsAsync, requestVoiceInputPermissionAsync } from '@/lib/voice/permissions';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useLocalVoiceEnrollment } from '@/lib/voice/use-local-voice-enrollment';

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
  rate,
  voiceId,
}: {
  locale?: string;
  localCommandModel: LocalCommandModelId;
  localWakePhrase: LocalWakePhraseId;
  rate: number;
  voiceId?: string;
}) {
  const { t } = useTranslation();
  const [capabilities, setCapabilities] = useState<VoiceCapabilities>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [localVoiceStatus, setLocalVoiceStatus] = useState<LocalVoiceModelStatus>('missing');
  const [isInstallingLocalVoice, setIsInstallingLocalVoice] = useState(false);
  const [localVoiceError, setLocalVoiceError] = useState<string>();
  const enrollment = useLocalVoiceEnrollment();

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
        onError: () => setFeedback(t('settings:voice.check.testFailed')),
        rate,
        text: t('settings:voice.check.testPhrase'),
        voice: voiceId,
      });
      if (!started) {
        setFeedback(t('settings:voice.check.testFailed'));
      }
    } finally {
      setIsTesting(false);
    }
  }, [locale, rate, t, voiceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate voice status once on mount.
    void refreshStatus();
  }, [refreshStatus]);

  const refreshLocalVoiceStatus = useCallback(() => {
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
      setLocalVoiceStatus('ready');
    } catch (error) {
      setLocalVoiceStatus('error');
      setLocalVoiceError(error instanceof Error ? error.message : 'Could not install the on-device voice models.');
    } finally {
      setIsInstallingLocalVoice(false);
    }
  }, [localCommandModel, localWakePhrase]);

  const removeLocalVoice = useCallback(async () => {
    setLocalVoiceError(undefined);
    try {
      await releaseLocalVoiceRuntime();
      await removeLocalVoiceModels();
      setLocalVoiceStatus(getLocalVoiceModelStatus(localCommandModel));
    } catch (error) {
      setLocalVoiceStatus('error');
      setLocalVoiceError(error instanceof Error ? error.message : 'Could not remove the on-device voice models.');
    }
  }, [localCommandModel]);

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
      clearError: useCallback(() => setLocalVoiceError(undefined), []),
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
