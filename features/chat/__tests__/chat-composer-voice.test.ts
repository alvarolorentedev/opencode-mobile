// @vitest-environment happy-dom

import { chatComposerProbe } from '../../../tests/helpers/chat-composer-probe';
import { describe, expect, it, vi } from 'vitest';

import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';

const device = vi.hoisted(() => ({ platform: 'web' }));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform(device));

type Element = { type: unknown; props: Record<string, any> };

function find(root: Element, testID: string): Element | undefined {
  if (root?.props?.testID === testID) return root;
  for (const child of [root?.props?.children].flat(Infinity)) {
    if (child && typeof child === 'object') {
      const match = find(child, testID);
      if (match) return match;
    }
  }
}

function mount({ conversationActive = false, isSpeechInputAvailable = false, voiceWakeMode = 'local' }: {
  conversationActive?: boolean;
  isSpeechInputAvailable?: boolean;
  voiceWakeMode?: 'local' | 'phrase';
}) {
  device.platform = 'android';
  return chatComposerProbe({
    chatPreferences: { ...defaultChatPreferences, voiceWakeMode },
    conversation: { active: conversationActive, isListening: false, phase: conversationActive ? 'armed' : 'off', readbackPhase: 'idle', wakePhrase: 'hey code', wakePhraseRequired: true },
    isSpeechInputAvailable,
  });
}

describe('composer voice availability', () => {
  it('starts conversation mode from on-device voice without a system recognizer', async () => {
    const runtime = mount({ voiceWakeMode: 'local' });
    expect(find(runtime.result.current, 'chat-primary-button')?.props.disabled).toBe(false);
    expect(find(runtime.result.current, 'chat-secondary-button')?.props.disabled).toBe(true);
  });

  it('keeps conversation mode disabled when only the missing system recognizer is selected', async () => {
    const runtime = mount({ voiceWakeMode: 'phrase' });
    expect(find(runtime.result.current, 'chat-primary-button')?.props.disabled).toBe(true);
    expect(find(runtime.result.current, 'chat-secondary-button')?.props.disabled).toBe(true);
  });

  it('keeps dictation and conversation available when the system recognizer exists', async () => {
    const runtime = mount({ isSpeechInputAvailable: true, voiceWakeMode: 'phrase' });
    expect(find(runtime.result.current, 'chat-primary-button')?.props.disabled).toBe(false);
    expect(find(runtime.result.current, 'chat-secondary-button')?.props.disabled).toBe(false);
  });

  it('can stop an active on-device conversation without a system recognizer', async () => {
    const runtime = mount({ conversationActive: true, voiceWakeMode: 'local' });
    expect(find(runtime.result.current, 'chat-primary-button')?.props.disabled).toBe(false);
  });
});
