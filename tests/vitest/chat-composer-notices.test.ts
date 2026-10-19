import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

const prompt = {
  id: 'm1',
  sessionId: 's',
  text: 'prompt text',
  createdAt: 1,
  attachments: [],
  delivery: 'steer' as const,
  state: 'waiting' as const,
};

async function mount(overrides: Record<string, unknown> = {}) {
  const runtime = hookRuntime();
  const { useChatComposerNotices } = await loadTs('components/chat/use-chat-composer-notices.ts', {
    react: runtime.react,
  }, runtime.globals);
  const inputRef = { current: { draft: 'previous draft' } };
  const setDraft = vi.fn((value: string) => { inputRef.current.draft = value; });
  const revertSession = vi.fn(async () => undefined);
  const unrevertSession = vi.fn(async () => undefined);
  const cancelPrompt = vi.fn(async () => undefined);
  runtime.mount(useChatComposerNotices, {
    cancelPrompt,
    currentSessionId: 's',
    inputRef,
    revertSession,
    setDraft,
    transcript: [{ id: 'm1', role: 'user', text: 'original prompt', createdAt: 1, details: [] }],
    unrevertSession,
    ...overrides,
  });
  return { runtime, inputRef, setDraft, revertSession, unrevertSession, cancelPrompt };
}

describe('composer notices', () => {
  it('prefills the reverted message text', async () => {
    const { runtime, inputRef, setDraft, revertSession } = await mount();
    await runtime.value.handleRevertMessage('s', 'm1');
    await runtime.settle();
    expect(revertSession).toHaveBeenCalledWith('s', 'm1');
    expect(setDraft).toHaveBeenCalledWith('original prompt');
    expect(inputRef.current.draft).toBe('original prompt');
  });

  it('clears an unchanged reverted draft when the revert is canceled', async () => {
    const { runtime, inputRef, setDraft, unrevertSession } = await mount();
    await runtime.value.handleRevertMessage('s', 'm1');
    await runtime.settle();
    inputRef.current.draft = 'original prompt';
    await runtime.value.handleCancelRevert('s');
    await runtime.settle();
    expect(unrevertSession).toHaveBeenCalledWith('s');
    expect(setDraft).toHaveBeenLastCalledWith('');
  });

  it('keeps an edited reverted draft when the revert is canceled', async () => {
    const { runtime, inputRef, setDraft } = await mount();
    await runtime.value.handleRevertMessage('s', 'm1');
    await runtime.settle();
    inputRef.current.draft = 'edited prompt';
    setDraft.mockClear();
    await runtime.value.handleCancelRevert('s');
    await runtime.settle();
    expect(setDraft).not.toHaveBeenCalledWith('');
  });

  it('moves a canceled pending prompt into an empty draft', async () => {
    const { runtime, inputRef, setDraft, cancelPrompt } = await mount();
    inputRef.current.draft = '';
    await runtime.value.handleCancelPendingPrompt(prompt);
    await runtime.settle();
    expect(cancelPrompt).toHaveBeenCalledWith('s', 'm1');
    expect(setDraft).toHaveBeenCalledWith('prompt text');
  });

  it('does not overwrite a non-empty draft when a pending prompt is canceled', async () => {
    const { runtime, setDraft, cancelPrompt } = await mount();
    await runtime.value.handleCancelPendingPrompt(prompt);
    await runtime.settle();
    expect(cancelPrompt).toHaveBeenCalledWith('s', 'm1');
    expect(setDraft).not.toHaveBeenCalled();
  });
});
