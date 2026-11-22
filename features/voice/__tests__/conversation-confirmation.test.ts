// @vitest-environment happy-dom

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationConfirmation } from '@/features/voice/state/conversation/use-conversation-confirmation';
import { defaultChatPreferences, type ChatPreferences } from '@/shared/preferences/opencode-preferences';
import { connectionViewProbe } from '../../../tests/helpers/connection-view-probe';
import { controlledClock, settleReact } from '../../../tests/helpers/controlled-clock';
import { renderHook } from '../../../tests/helpers/render-hook';

const { speakText } = vi.hoisted(() => ({ speakText: vi.fn() }));
vi.mock('@/shared/platform/voice/speech-output', () => ({
  speakText, stopSpeaking: async () => undefined,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

let clock: ReturnType<typeof controlledClock>;
beforeEach(() => { clock = controlledClock(); });

async function confirmationHarness(overrides: Partial<ChatPreferences> = {}) {
  let speechOptions: any;
  const submitCommand = vi.fn();
  const retryCommand = vi.fn(async () => true);
  const rearmConversation = vi.fn(async () => undefined);
  const startSystemConfirmation = vi.fn(async () => true);
  const startLocalConfirmation = vi.fn(async () => true);
  const stopLocalConfirmation = vi.fn(async () => undefined);
  const stopSystemInput = vi.fn();
  const phaseRef: { current: import('@/features/voice/model/types').ConversationPhase } = { current: 'off' };
  speakText.mockReset().mockImplementation(async (options: typeof speechOptions) => {
    speechOptions = options;
    options.onStart();
    return true;
  });

  const preferences: ChatPreferences = {
    ...defaultChatPreferences,
    confirmVoiceCommands: true,
    localTtsPackId: undefined,
    localTtsSpeakerId: 0,
    speechLocale: 'en-US',
    speechRate: 1,
    speechVoiceId: undefined,
    ttsEngine: 'system',
    ...overrides,
  };

  const runtime = renderHook(useConversationConfirmation, {
    scopeKey: 'confirmation-test-workspace',
    chatPreferences: preferences,
    connectionStatus: 'connected',
    conversationSessionId: 'session-1',
    rearmConversation,
    retryCommand,
    setConversationFeedback: vi.fn(),
    setConversationFeedbackAction: vi.fn(),
    setConversationLatestHeardText: vi.fn(),
    setConversationPhase: (value: any) => { phaseRef.current = typeof value === 'function' ? value(phaseRef.current) : value; },
    startLocalConfirmation,
    startSystemConfirmation,
    stopLocalConfirmation,
    stopSystemInput,
    submitCommand,
  }, connectionViewProbe({} as never));
  await settleReact();

  const beginToListening = async (source: 'system' | 'local' = 'system') => {
    let began = false;
    act(() => { began = runtime.result.current.begin('Refactor the login component', source); });
    expect(began).toBe(true);
    await settleReact();
    await clock.advance(120);
    await settleReact();
    expect(speechOptions).toBeDefined();
    act(() => { speechOptions.onDone(); });
    await settleReact();
    await clock.advance(300);
    await settleReact();
    if (source === 'local') expect(startLocalConfirmation).toHaveBeenCalledOnce();
    else expect(startSystemConfirmation).toHaveBeenCalledOnce();
  };

  return {
    unmount: runtime.unmount,
    get value() { return runtime.result.current; },
    begin(command: string, source: 'system' | 'local') {
      let began = false;
      act(() => { began = runtime.result.current.begin(command, source); });
      return began;
    },
    beginToListening,
    rearmConversation,
    retryCommand,
    speechOptions: () => speechOptions,
    startLocalConfirmation,
    startSystemConfirmation,
    submitCommand,
  };
}

describe('voice command confirmation', () => {
  it('waits for TTS and the echo guard before listening, then submits only confirmed text', async () => {
    const view = await confirmationHarness();
    await view.beginToListening();
    expect(view.value.confirmation?.phase).toBe('listening');
    expect(view.submitCommand).not.toHaveBeenCalled();

    // An interim "yes" is not a confirmation.
    act(() => { view.value.handleResult('yes', false); });
    expect(view.submitCommand).not.toHaveBeenCalled();
    act(() => { view.value.handleResult('yes', true); });
    await settleReact();
    expect(view.submitCommand).toHaveBeenCalledOnce();
    expect(view.submitCommand).toHaveBeenCalledWith('Refactor the login component');
  });

  it('uses the selected local recognizer for local confirmation', async () => {
    const view = await confirmationHarness();
    await view.beginToListening('local');
    expect(view.startLocalConfirmation).toHaveBeenCalledOnce();
    act(() => { view.value.handleResult('yes', true); });
    await settleReact();
    expect(view.submitCommand).toHaveBeenCalledWith('Refactor the login component');
  });

  it('does not act on recognition while the prompt is still speaking', async () => {
    const view = await confirmationHarness();
    expect(view.begin('Run tests', 'system')).toBe(true);
    await settleReact();
    act(() => { view.value.handleResult('yes', true); });
    expect(view.submitCommand).not.toHaveBeenCalled();
  });

  it('treats extra words as ambiguous and times out without submitting', async () => {
    const view = await confirmationHarness();
    await view.beginToListening();
    act(() => { view.value.handleResult('yes but change it', true); });
    await settleReact();
    expect(view.submitCommand).not.toHaveBeenCalled();
    expect(view.value.confirmation?.phase).toBe('listening');
    await clock.advance(300);
    await settleReact();
    act(() => { view.value.handleResult('still not sure', true); });
    await settleReact();
    expect(view.value.confirmation?.phase).toBe('expired');
    expect(view.submitCommand).not.toHaveBeenCalled();
  });

  it('supports retry, edit and cancel without leaking a submission', async () => {
    const retryView = await confirmationHarness();
    await retryView.beginToListening();
    act(() => { retryView.value.confirmation?.actions.retry(); });
    await settleReact();
    expect(retryView.value.confirmation).toBeUndefined();
    expect(retryView.retryCommand).toHaveBeenCalledOnce();
    expect(retryView.submitCommand).not.toHaveBeenCalled();
    retryView.unmount();

    const editView = await confirmationHarness();
    await editView.beginToListening();
    act(() => { editView.value.confirmation?.actions.edit(); });
    await settleReact();
    expect(editView.value.confirmation?.phase).toBe('editing');
    act(() => { editView.value.confirmation?.actions.confirm('Refactor the sign-in component'); });
    await settleReact();
    expect(editView.submitCommand).toHaveBeenCalledWith('Refactor the sign-in component');
    editView.unmount();

    const cancelView = await confirmationHarness();
    await cancelView.beginToListening();
    act(() => { cancelView.value.confirmation?.actions.cancel(); });
    await settleReact();
    expect(cancelView.value.confirmation).toBeUndefined();
    expect(cancelView.rearmConversation).toHaveBeenCalledOnce();
    expect(cancelView.submitCommand).not.toHaveBeenCalled();
  });

  it('expires the listening window without submitting, then dismisses safely', async () => {
    const view = await confirmationHarness();
    await view.beginToListening();
    await clock.advance(15000);
    await settleReact();
    expect(view.value.confirmation?.phase).toBe('expired');
    expect(view.submitCommand).not.toHaveBeenCalled();
    await clock.advance(60000);
    await settleReact();
    expect(view.value.confirmation).toBeUndefined();
    expect(view.rearmConversation).toHaveBeenCalledOnce();
    expect(view.submitCommand).not.toHaveBeenCalled();
  });

  it('keeps confirmation off when explicitly disabled', async () => {
    const view = await confirmationHarness({ confirmVoiceCommands: false });
    expect(view.begin('Run tests', 'system')).toBe(false);
    expect(view.value.confirmation).toBeUndefined();
    expect(view.submitCommand).not.toHaveBeenCalled();
  });

  it('cannot submit the same confirmation twice', async () => {
    const view = await confirmationHarness();
    await view.beginToListening();
    act(() => { view.value.handleResult('yes', true); });
    act(() => { view.value.handleResult('yes', true); });
    await settleReact();
    expect(view.submitCommand).toHaveBeenCalledOnce();
  });
});
