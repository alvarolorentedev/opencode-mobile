import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';
import type { ChatPreferences } from '@/providers/opencode-preferences';

async function confirmationHarness(overrides: Partial<ChatPreferences> = {}) {
  const runtime = hookRuntime();
  let speechOptions: any;
  const submitCommand = vi.fn();
  const retryCommand = vi.fn(async () => true);
  const rearmConversation = vi.fn(async () => undefined);
  const startSystemConfirmation = vi.fn(async () => true);
  const startLocalConfirmation = vi.fn(async () => true);
  const stopLocalConfirmation = vi.fn(async () => undefined);
  const stopSystemInput = vi.fn();
  const phaseRef = { current: 'off' as const };
  const confirmationTypes = await loadTs('providers/conversation/confirmation-types.ts');
  const useLatest = await loadTs('providers/conversation/use-latest.ts', { react: runtime.react }, runtime.globals);
  const confirmationGrammar = await loadTs('lib/voice/confirmation.ts');
  const feedback = await loadTs('providers/conversation/feedback.ts');
  const speechConfig = { getSpeechPlayback: () => ({ engine: 'system' }) };
  const speechOutput = {
    stopSpeaking: vi.fn(async () => undefined),
    speakText: vi.fn(async (options: any) => {
      speechOptions = options;
      options.onStart();
      return true;
    }),
  };
  const hook = await loadTs('providers/conversation/use-conversation-confirmation.ts', {
    react: runtime.react,
    '@/lib/i18n': { i18n: {
      getFixedT: () => (key: string, args?: { command?: string }) => args?.command ? `${key}:${args.command}` : key,
      t: (key: string, args?: { command?: string }) => args?.command ? `${key}:${args.command}` : key,
    } },
    '@/lib/voice/confirmation': confirmationGrammar,
    '@/lib/voice/speech-config': speechConfig,
    '@/lib/voice/speech-output': speechOutput,
    '@/providers/conversation/confirmation-types': confirmationTypes,
    '@/providers/conversation/feedback': feedback,
    '@/providers/conversation/use-latest': useLatest,
  }, runtime.globals);

  const preferences = {
    confirmVoiceCommands: true,
    localTtsPackId: undefined,
    localTtsSpeakerId: 0,
    speechLocale: 'en-US',
    speechRate: 1,
    speechVoiceId: undefined,
    ttsEngine: 'system',
    ...overrides,
  } as ChatPreferences;

  runtime.mount(hook.useConversationConfirmation, {
    chatPreferences: preferences,
    connectionStatus: 'connected',
    conversationPhaseRef: phaseRef,
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
  });
  await runtime.settle();

  const beginToListening = async (source: 'system' | 'local' = 'system') => {
    expect(runtime.value.begin('Refactor the login component', source)).toBe(true);
    await runtime.settle();
    runtime.fire(120);
    await runtime.settle();
    expect(speechOptions).toBeDefined();
    speechOptions.onDone();
    await runtime.settle();
    runtime.fire(300);
    await runtime.settle();
    if (source === 'local') expect(startLocalConfirmation).toHaveBeenCalledOnce();
    else expect(startSystemConfirmation).toHaveBeenCalledOnce();
  };

  return {
    ...runtime,
    get value() { return runtime.value; },
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
    view.value.handleResult('yes', false);
    expect(view.submitCommand).not.toHaveBeenCalled();
    view.value.handleResult('yes', true);
    await view.settle();
    expect(view.submitCommand).toHaveBeenCalledOnce();
    expect(view.submitCommand).toHaveBeenCalledWith('Refactor the login component');
  });

  it('uses the selected local recognizer for local confirmation', async () => {
    const view = await confirmationHarness();
    await view.beginToListening('local');
    expect(view.startLocalConfirmation).toHaveBeenCalledOnce();
    view.value.handleResult('yes', true);
    await view.settle();
    expect(view.submitCommand).toHaveBeenCalledWith('Refactor the login component');
  });

  it('does not act on recognition while the prompt is still speaking', async () => {
    const view = await confirmationHarness();
    expect(view.value.begin('Run tests', 'system')).toBe(true);
    await view.settle();
    view.value.handleResult('yes', true);
    expect(view.submitCommand).not.toHaveBeenCalled();
  });

  it('treats extra words as ambiguous and times out without submitting', async () => {
    const view = await confirmationHarness();
    await view.beginToListening();
    view.value.handleResult('yes but change it', true);
    await view.settle();
    expect(view.submitCommand).not.toHaveBeenCalled();
    expect(view.value.confirmation?.phase).toBe('listening');
    view.fire(300);
    await view.settle();
    view.value.handleResult('still not sure', true);
    await view.settle();
    expect(view.value.confirmation?.phase).toBe('expired');
    expect(view.submitCommand).not.toHaveBeenCalled();
  });

  it('supports retry, edit and cancel without leaking a submission', async () => {
    const retryView = await confirmationHarness();
    await retryView.beginToListening();
    retryView.value.confirmation?.actions.retry();
    await retryView.settle();
    expect(retryView.value.confirmation).toBeUndefined();
    expect(retryView.retryCommand).toHaveBeenCalledOnce();
    expect(retryView.submitCommand).not.toHaveBeenCalled();

    const editView = await confirmationHarness();
    await editView.beginToListening();
    editView.value.confirmation?.actions.edit();
    await editView.settle();
    expect(editView.value.confirmation?.phase).toBe('editing');
    editView.value.confirmation?.actions.confirm('Refactor the sign-in component');
    await editView.settle();
    expect(editView.submitCommand).toHaveBeenCalledWith('Refactor the sign-in component');

    const cancelView = await confirmationHarness();
    await cancelView.beginToListening();
    cancelView.value.confirmation?.actions.cancel();
    await cancelView.settle();
    expect(cancelView.value.confirmation).toBeUndefined();
    expect(cancelView.rearmConversation).toHaveBeenCalledOnce();
    expect(cancelView.submitCommand).not.toHaveBeenCalled();
  });

  it('expires the listening window without submitting, then dismisses safely', async () => {
    const view = await confirmationHarness();
    await view.beginToListening();
    view.fire(15000);
    await view.settle();
    expect(view.value.confirmation?.phase).toBe('expired');
    expect(view.submitCommand).not.toHaveBeenCalled();
    view.fire(60000);
    await view.settle();
    expect(view.value.confirmation).toBeUndefined();
    expect(view.rearmConversation).toHaveBeenCalledOnce();
    expect(view.submitCommand).not.toHaveBeenCalled();
  });

  it('keeps confirmation off when explicitly disabled', async () => {
    const view = await confirmationHarness({ confirmVoiceCommands: false });
    expect(view.value.begin('Run tests', 'system')).toBe(false);
    expect(view.value.confirmation).toBeUndefined();
    expect(view.submitCommand).not.toHaveBeenCalled();
  });

  it('cannot submit the same confirmation twice', async () => {
    const view = await confirmationHarness();
    await view.beginToListening();
    view.value.handleResult('yes', true);
    view.value.handleResult('yes', true);
    await view.settle();
    expect(view.submitCommand).toHaveBeenCalledOnce();
  });
});
