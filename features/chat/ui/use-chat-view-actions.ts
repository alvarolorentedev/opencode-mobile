import { ActionSheetIOS, Platform } from 'react-native';
import type { Dispatch, SetStateAction } from 'react';

import { useUpdates } from '@/features/updates/context';
import type { TranscriptEntry } from '@/shared/presentation/format';
import { pickedAttachment } from '@/shared/platform/attachments';
import { speakText, stopSpeaking } from '@/shared/platform/voice/speech-output';
import { getSpeechPlayback } from '@/shared/platform/voice/speech-config';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';

type Attachment = { uri: string; mime?: string; filename?: string };
type PickerAsset = { uri: string; base64?: string; mimeType?: string; name: string; size?: number };

type ChatViewActionsInput = {
  t: (key: string) => string;
  chatPreferences: ChatPreferences;
  conversationActive: boolean;
  currentSessionId?: string;
  speakingMessageId?: string;
  abortSession: (sessionId: string) => Promise<void>;
  toggleConversationMode: () => Promise<void>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setSendFeedback: Dispatch<SetStateAction<string | undefined>>;
  setIsStoppingSession: Dispatch<SetStateAction<boolean>>;
  setSpeakingMessageId: Dispatch<SetStateAction<string | undefined>>;
  setVoiceFeedback: Dispatch<SetStateAction<string | undefined>>;
};

export function useChatViewActions({
  t,
  chatPreferences,
  conversationActive,
  currentSessionId,
  speakingMessageId,
  abortSession,
  toggleConversationMode,
  setAttachments,
  setSendFeedback,
  setIsStoppingSession,
  setSpeakingMessageId,
  setVoiceFeedback,
}: ChatViewActionsInput) {
  const { block } = useUpdates();
  async function handleSpeakEntry(entry: TranscriptEntry) {
    if (speakingMessageId === entry.id) {
      await stopSpeaking().catch(() => undefined);
      setSpeakingMessageId(undefined);
      return;
    }

    if (conversationActive) {
      setVoiceFeedback(t('chat:view.stopConversationBeforePlay'));
      return;
    }

    const started = await speakText({
      language: chatPreferences.speechLocale,
      onDone: () => {
        setSpeakingMessageId((current) => (current === entry.id ? undefined : current));
      },
      onEngineFallback: () => {
        setVoiceFeedback(t('chat:view.ttsFallback'));
      },
      onError: () => {
        setVoiceFeedback(t('chat:view.unableToPlay'));
        setSpeakingMessageId(undefined);
      },
      onStart: () => setSpeakingMessageId(entry.id),
      playback: getSpeechPlayback(chatPreferences),
      rate: chatPreferences.speechRate,
      text: entry.text,
    });

    if (!started) {
      setVoiceFeedback(t('chat:view.noReadableText'));
    }
  }

  async function handleAttach(anchor?: number) {
    const release = block();
    try {
      let assets: PickerAsset[];
      if (Platform.OS === 'ios') {
        const choice = await new Promise<number>((resolve) => {
          ActionSheetIOS.showActionSheetWithOptions({
            anchor,
            cancelButtonIndex: 2,
            options: [t('chat:composer.photoLibrary'), t('chat:composer.chooseFiles'), t('common:actions.cancel')],
          }, resolve);
        });
        if (choice === 2) return;

        if (choice === 0) {
          const picker = await import('expo-image-picker');
          const result = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true });
          if (result.canceled || !result.assets?.length) return;
          assets = result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName ?? 'photo', mimeType: asset.mimeType ?? undefined, size: asset.fileSize ?? undefined }));
        } else {
          const picker = await import('expo-document-picker');
          const result = await picker.getDocumentAsync({ base64: false, multiple: true, copyToCacheDirectory: true });
          if (result.canceled || !result.assets?.length) return;
          assets = result.assets;
        }
      } else {
        const picker = await import('expo-document-picker');
        const result = await picker.getDocumentAsync({
          base64: Platform.OS === 'web',
          multiple: true,
          copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets?.length) return;
        assets = result.assets;
      }

      if (assets.some((asset) => typeof asset.size === 'number' && asset.size > 10 * 1024 * 1024)) {
        setSendFeedback(t('chat:view.fileTooLarge'));
        return;
      }

      setSendFeedback(undefined);
      setAttachments((current) => {
        const next = [...current];

        assets.forEach((asset) => {
          const attachment = pickedAttachment(asset);
          if (!next.some((current) => current.uri === attachment.uri)) {
            next.push(attachment);
          }
        });

        return next;
      });
    } catch (error) {
      setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotAttach'));
    } finally { release(); }
  }

  async function handleAbort() {
    if (!currentSessionId) {
      return;
    }

    setIsStoppingSession(true);
    try {
      await abortSession(currentSessionId);
    } catch (error) {
      setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotStopSession'));
    } finally {
      setIsStoppingSession(false);
    }
  }

  function handleStopConversation() {
    void toggleConversationMode();
  }

  return {
    handleSpeakEntry,
    handleAttach,
    handleAbort,
    handleStopConversation,
  };
}
