import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { modelDownloadErrorMessageKey } from '@/shared/platform/models/model-download';
import { getLocalTtsPack, LOCAL_TTS_PACKS, localTtsSizeLabel } from '@/shared/platform/voice/tts/catalog';
import { cleanupLocalTtsStaging, getLocalTtsPackStatus, getLocalTtsPackStatuses, getLocalTtsStorageBytes, installLocalTtsPack, removeLocalTtsPack } from '@/shared/platform/voice/tts/models';
import { releaseLocalTtsRuntime } from '@/shared/platform/voice/tts/runtime';
import type { LocalTtsPackId, LocalTtsPackStatus } from '@/shared/platform/voice/tts/types';
import { speakText, stopSpeaking } from '@/shared/platform/voice/speech-output';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

export function useTtsSetup({
  chatPreferences,
  rate,
  updateChatPreferences,
}: {
  chatPreferences: ChatPreferences;
  rate: number;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
}) {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState<Record<LocalTtsPackId, LocalTtsPackStatus>>(
    () => getLocalTtsPackStatuses(),
  );
  const [storageBytes, setStorageBytes] = useState(() => getLocalTtsStorageBytes());
  const [isInstallingPack, setIsInstallingPack] = useState<LocalTtsPackId>();
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<string>();
  const [errorPackId, setErrorPackId] = useState<LocalTtsPackId>();

  const refresh = useCallback(() => {
    cleanupLocalTtsStaging();
    setStatuses(getLocalTtsPackStatuses());
    setStorageBytes(getLocalTtsStorageBytes());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate on-device playback status once on mount.
    refresh();
  }, [refresh]);

  useEffect(() => () => {
    void stopSpeaking().catch(() => undefined);
  }, []);

  const install = useCallback(async (packId: LocalTtsPackId) => {
    setError(undefined);
    setErrorPackId(undefined);
    setIsInstallingPack(packId);
    try {
      await installLocalTtsPack(packId);
      refresh();
    } catch (installError) {
      refresh();
      setError(t(modelDownloadErrorMessageKey(installError)));
      setErrorPackId(packId);
    } finally {
      setIsInstallingPack(undefined);
    }
  }, [refresh, t]);

  const remove = useCallback(async (packId: LocalTtsPackId) => {
    setError(undefined);
    setErrorPackId(undefined);
    await stopSpeaking().catch(() => undefined);
    await releaseLocalTtsRuntime().catch(() => undefined);
    try {
      await removeLocalTtsPack(packId);
      if (chatPreferences.localTtsPackId === packId) {
        updateChatPreferences({
          localTtsPackId: undefined,
          localTtsSpeakerId: 0,
          ttsEngine: 'system',
        });
      }
      refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the voice model.');
    }
  }, [chatPreferences.localTtsPackId, refresh, updateChatPreferences]);

  const select = useCallback(async (packId: LocalTtsPackId) => {
    if (getLocalTtsPackStatus(packId) !== 'ready') {
      setError(t('settings:voice.localTts.installFirst'));
      setErrorPackId(packId);
      return;
    }
    setError(undefined);
    setErrorPackId(undefined);
    await stopSpeaking().catch(() => undefined);
    updateChatPreferences({
      localTtsPackId: packId,
      localTtsSpeakerId: 0,
      ttsEngine: 'local',
    });
  }, [t, updateChatPreferences]);

  const setEngine = useCallback(async (engine: 'system' | 'local') => {
    setError(undefined);
    setErrorPackId(undefined);
    if (engine === 'system') {
      await stopSpeaking().catch(() => undefined);
      updateChatPreferences({ ttsEngine: 'system' });
      return true;
    }

    const pack = chatPreferences.localTtsPackId ? getLocalTtsPack(chatPreferences.localTtsPackId) : undefined;
    if (!pack || getLocalTtsPackStatus(pack.id) !== 'ready') {
      setError(t('settings:voice.localTts.installFirst'));
      setErrorPackId(undefined);
      return false;
    }
    updateChatPreferences({ ttsEngine: 'local' });
    return true;
  }, [chatPreferences.localTtsPackId, t, updateChatPreferences]);

  const setSpeaker = useCallback((speakerId: number) => {
    updateChatPreferences({ localTtsSpeakerId: speakerId });
  }, [updateChatPreferences]);

  const preview = useCallback(async (packId: LocalTtsPackId, speakerId: number) => {
    const pack = getLocalTtsPack(packId);
    if (!pack) {
      return;
    }
    setError(undefined);
    setErrorPackId(undefined);
    setIsPreviewing(true);
    try {
      const started = await speakText({
        language: pack.locale,
        onDone: () => setIsPreviewing(false),
        onEngineFallback: () => setError(t('settings:voice.localTts.fallbackToSystem')),
        onError: () => {
          setError(t('settings:voice.check.testFailed'));
          setIsPreviewing(false);
        },
        playback: { engine: 'local', packId, speakerId },
        rate,
        text: t('settings:voice.check.testPhrase'),
      });
      if (!started) {
        setIsPreviewing(false);
      }
    } catch {
      setError(t('settings:voice.check.testFailed'));
      setIsPreviewing(false);
    }
  }, [rate, t]);

  const activePack = chatPreferences.localTtsPackId
    ? getLocalTtsPack(chatPreferences.localTtsPackId)
    : undefined;
  const readyPackCount = LOCAL_TTS_PACKS.filter((pack) => statuses[pack.id] === 'ready').length;

  return {
    activePack,
    error,
    errorPackId,
    install,
    isInstallingPack,
    isPreviewing,
    packs: LOCAL_TTS_PACKS,
    preview,
    readyPackCount,
    refresh,
    remove,
    select,
    setEngine,
    setSpeaker,
    sizeLabel: (bytes: number) => localTtsSizeLabel(bytes),
    statuses,
    storageBytes,
  };
}
