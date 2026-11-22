import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

async function mount({
  platform = 'ios',
  choice = 0,
  images = [],
  imageCanceled = false,
  files = [],
  initialAttachments = [],
}: {
  platform?: string;
  choice?: number;
  images?: { uri: string; fileName?: string | null; mimeType?: string | null; fileSize?: number }[];
  imageCanceled?: boolean;
  files?: { uri: string; name: string; mimeType?: string; size?: number }[];
  initialAttachments?: { uri: string; mime?: string; filename?: string }[];
} = {}) {
  const runtime = hookRuntime();
  let attachments = initialAttachments;
  const actionSheet = vi.fn((_options: unknown, callback: (index: number) => void) => callback(choice));
  const launchImageLibraryAsync = vi.fn(async () => ({ canceled: imageCanceled, assets: imageCanceled ? null : images }));
  const requestMediaLibraryPermissionsAsync = vi.fn();
  const getDocumentAsync = vi.fn(async () => ({ canceled: false, assets: files }));
  const release = vi.fn();
  const setAttachments = vi.fn((next: typeof attachments | ((current: typeof attachments) => typeof attachments)) => {
    attachments = typeof next === 'function' ? next(attachments) : next;
  });
  const setSendFeedback = vi.fn();
  const { useChatViewActions } = await loadTs('features/chat/ui/use-chat-view-actions.ts', {
    react: runtime.react,
    'react-native': { ActionSheetIOS: { showActionSheetWithOptions: actionSheet }, Platform: { OS: platform } },
    '@/features/updates/index': { useUpdateBlockingConfirmation: () => ({ confirmAction: vi.fn(), confirmation: null }) },
    '@/features/updates/context': { useUpdates: () => ({ block: () => release }) },
    '@/shared/platform/attachments': {
      pickedAttachment: (asset: { uri: string; name: string; mimeType?: string }) => ({
        uri: asset.uri,
        mime: asset.mimeType || 'application/octet-stream',
        filename: asset.name,
      }),
    },
    '@/shared/platform/voice/speech-output': { speakText: vi.fn(), stopSpeaking: vi.fn() },
    '@/shared/platform/voice/speech-config': { getSpeechPlayback: vi.fn() },
    'expo-image-picker': { launchImageLibraryAsync, requestMediaLibraryPermissionsAsync },
    'expo-document-picker': { getDocumentAsync },
  }, runtime.globals);
  runtime.mount(useChatViewActions, {
    t: (key: string) => key,
    chatPreferences: {},
    conversationActive: false,
    abortSession: vi.fn(),
    toggleConversationMode: vi.fn(),
    setAttachments,
    setSendFeedback,
    setIsStoppingSession: vi.fn(),
    setSpeakingMessageId: vi.fn(),
    setVoiceFeedback: vi.fn(),
  });
  return { runtime, actionSheet, launchImageLibraryAsync, requestMediaLibraryPermissionsAsync, getDocumentAsync, release, attachments: () => attachments, setSendFeedback };
}

describe('chat attachment picker', () => {
  it('offers Photos or Files on iOS and adds selected images through the attachment pipeline', async () => {
    const existing = { uri: 'file:///already-added.png', mime: 'image/png', filename: 'already-added.png' };
    const app = await mount({
      choice: 0,
      images: [
        { uri: 'file:///new.png', fileName: 'screenshot.png', mimeType: 'image/png', fileSize: 1024 },
        { uri: existing.uri, fileName: 'duplicate.png', mimeType: 'image/png', fileSize: 1024 },
      ],
      initialAttachments: [existing],
    });

    await app.runtime.value.handleAttach(42);

    expect(app.actionSheet.mock.calls[0][0]).toMatchObject({
      anchor: 42,
      cancelButtonIndex: 2,
      options: ['chat:composer.photoLibrary', 'chat:composer.chooseFiles', 'common:actions.cancel'],
    });
    expect(app.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ['images'], allowsMultipleSelection: true });
    expect(app.attachments()).toEqual([existing, { uri: 'file:///new.png', mime: 'image/png', filename: 'screenshot.png' }]);
    expect(app.getDocumentAsync).not.toHaveBeenCalled();
    expect(app.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(app.setSendFeedback).toHaveBeenCalledWith(undefined);
    expect(app.release).toHaveBeenCalledOnce();
  });

  it('rejects an oversized library image and releases the update blocker', async () => {
    const app = await mount({ images: [{ uri: 'file:///large.png', fileName: 'large.png', fileSize: 10 * 1024 * 1024 + 1 }] });

    await app.runtime.value.handleAttach();

    expect(app.setSendFeedback).toHaveBeenCalledWith('chat:view.fileTooLarge');
    expect(app.attachments()).toEqual([]);
    expect(app.release).toHaveBeenCalledOnce();
  });

  it('leaves attachments unchanged when the iOS chooser or picker is canceled', async () => {
    const fromSheet = await mount({ choice: 2 });
    await fromSheet.runtime.value.handleAttach();
    expect(fromSheet.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(fromSheet.getDocumentAsync).not.toHaveBeenCalled();
    expect(fromSheet.release).toHaveBeenCalledOnce();

    const canceledPicker = await mount({ imageCanceled: true });
    await canceledPicker.runtime.value.handleAttach();
    expect(canceledPicker.attachments()).toEqual([]);
    expect(canceledPicker.setSendFeedback).not.toHaveBeenCalled();
  });

  it('keeps Choose Files and non-iOS platforms on the document picker', async () => {
    const iosFiles = await mount({ choice: 1, files: [{ uri: 'file:///notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 4 }] });
    await iosFiles.runtime.value.handleAttach();
    expect(iosFiles.getDocumentAsync).toHaveBeenCalledWith({ base64: false, multiple: true, copyToCacheDirectory: true });
    expect(iosFiles.attachments()).toEqual([{ uri: 'file:///notes.txt', mime: 'text/plain', filename: 'notes.txt' }]);

    for (const [platform, base64] of [['android', false], ['web', true]] as const) {
      const app = await mount({ platform, files: [{ uri: 'file:///notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 4 }] });
      await app.runtime.value.handleAttach();
      expect(app.actionSheet).not.toHaveBeenCalled();
      expect(app.getDocumentAsync).toHaveBeenCalledWith({ base64, multiple: true, copyToCacheDirectory: true });
      expect(app.attachments()).toHaveLength(1);
    }
  });
});
