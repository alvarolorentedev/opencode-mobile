// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import { renderHook } from '../../../tests/helpers/render-hook';
import { nativeViewPlatform } from '../../../tests/helpers/native-view-platform';

const native = vi.hoisted(() => ({ platform: 'android' }));

vi.mock('react-native', async () => ({
  ...nativeViewPlatform(native),
  ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
}));
vi.mock('@/features/updates/context', () => ({ useUpdates: () => ({ block: () => () => undefined }) }));
vi.mock('@/shared/platform/attachments', () => ({ pickedAttachment: (asset: unknown) => asset }));
vi.mock('@/shared/platform/voice/speech-output', () => ({
  speakText: vi.fn(async () => true),
  stopSpeaking: vi.fn(async () => undefined),
}));
vi.mock('@/shared/platform/voice/speech-config', () => ({ getSpeechPlayback: () => ({ engine: 'system' }) }));

const { useChatViewActions } = await import('@/features/chat/ui/use-chat-view-actions');

describe('chat view actions', () => {
  it('stops conversation mode immediately without a confirmation surface', () => {
    const toggleConversationMode = vi.fn(async () => undefined);
    const runtime = renderHook(useChatViewActions, {
      t: (key: string) => key,
      chatPreferences: defaultChatPreferences,
      conversationActive: true,
      currentSessionId: 'session-1',
      abortSession: vi.fn(async () => undefined),
      toggleConversationMode,
      setAttachments: vi.fn(),
      setSendFeedback: vi.fn(),
      setIsStoppingSession: vi.fn(),
      setSpeakingMessageId: vi.fn(),
      setVoiceFeedback: vi.fn(),
    });

    runtime.result.current.handleStopConversation();

    expect(toggleConversationMode).toHaveBeenCalledOnce();
    expect(Object.keys(runtime.result.current)).not.toContain('confirmation');
  });
});
