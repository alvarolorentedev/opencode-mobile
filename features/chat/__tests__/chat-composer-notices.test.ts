// @vitest-environment happy-dom

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useChatComposerNotices } from '@/features/chat/ui/use-chat-composer-notices';
import { renderHook } from '../../../tests/helpers/render-hook';

const prompt = {
  id: 'm1',
  sessionId: 's',
  text: 'prompt text',
  createdAt: 1,
  attachments: [],
  delivery: 'steer' as const,
  state: 'waiting' as const,
};

const attachment = { uri: 'data:text/plain;base64,aGVsbG8=', mime: 'text/plain', filename: 'notes.txt' };
const attachmentDetail = { id: 'm1-1', kind: 'file' as const, label: 'notes.txt', body: 'text/plain', ...attachment };

function mount(overrides: Partial<Parameters<typeof useChatComposerNotices>[0]> = {}) {
  const inputRef = { current: { draft: 'previous draft', attachments: [] as { uri: string; mime?: string; filename?: string }[] } };
  const setDraft = vi.fn((value: string) => { inputRef.current.draft = value; });
  const setAttachments = vi.fn((value: { uri: string; mime?: string; filename?: string }[]) => { inputRef.current.attachments = value; });
  const revertSession = vi.fn(async () => undefined);
  const unrevertSession = vi.fn(async () => undefined);
  const cancelPrompt = vi.fn(async () => undefined);
  const runtime = renderHook(useChatComposerNotices, {
    cancelPrompt,
    currentSessionId: 's',
    inputRef,
    revertSession,
    setAttachments,
    setDraft,
    transcript: [{ id: 'm1', role: 'user', text: 'original prompt', createdAt: 1, details: [attachmentDetail] }],
    unrevertSession,
    ...overrides,
  });
  return { runtime, inputRef, setDraft, setAttachments, revertSession, unrevertSession, cancelPrompt };
}

describe('composer notices', () => {
  it('prefills the reverted message text and attachments', async () => {
    const { runtime, inputRef, setAttachments, setDraft, revertSession } = mount();
    await act(() => runtime.result.current.handleRevertMessage('s', 'm1'));
    expect(revertSession).toHaveBeenCalledWith('s', 'm1');
    expect(setDraft).toHaveBeenCalledWith('original prompt');
    expect(inputRef.current.draft).toBe('original prompt');
    expect(setAttachments).toHaveBeenCalledWith([attachment]);
    expect(inputRef.current.attachments).toEqual([attachment]);
  });

  it('prefills an attachment-only reverted message', async () => {
    const { runtime, inputRef, setAttachments, setDraft } = mount({
      transcript: [{ id: 'm1', role: 'user', text: '', createdAt: 1, details: [attachmentDetail] }],
    });
    await act(() => runtime.result.current.handleRevertMessage('s', 'm1'));
    expect(setDraft).toHaveBeenCalledWith('');
    expect(setAttachments).toHaveBeenCalledWith([attachment]);
    expect(inputRef.current.attachments).toEqual([attachment]);
  });

  it('leaves the composer unchanged when the revert fails', async () => {
    const { runtime, setAttachments, setDraft, revertSession } = mount();
    revertSession.mockRejectedValueOnce(new Error('stage failed'));

    await expect(act(() => runtime.result.current.handleRevertMessage('s', 'm1'))).rejects.toThrow('stage failed');
    expect(setDraft).not.toHaveBeenCalled();
    expect(setAttachments).not.toHaveBeenCalled();
  });

  it('ignores a second revert request while the first is in flight', async () => {
    const { runtime, revertSession } = mount();
    let resolve!: (value: undefined) => void;
    revertSession.mockReturnValueOnce(new Promise<undefined>((done) => { resolve = done; }));

    const first = runtime.result.current.handleRevertMessage('s', 'm1');
    const second = runtime.result.current.handleRevertMessage('s', 'm1');
    expect(revertSession).toHaveBeenCalledTimes(1);

    resolve(undefined);
    await act(() => Promise.all([first, second]));
  });

  it('clears an unchanged reverted draft and attachments when the revert is canceled', async () => {
    const { runtime, inputRef, setAttachments, setDraft, unrevertSession } = mount();
    await act(() => runtime.result.current.handleRevertMessage('s', 'm1'));
    inputRef.current.draft = 'original prompt';
    await act(() => runtime.result.current.handleCancelRevert('s'));
    expect(unrevertSession).toHaveBeenCalledWith('s');
    expect(setDraft).toHaveBeenLastCalledWith('');
    expect(setAttachments).toHaveBeenLastCalledWith([]);
  });

  it('keeps an edited reverted draft when the revert is canceled', async () => {
    const { runtime, inputRef, setDraft } = mount();
    await act(() => runtime.result.current.handleRevertMessage('s', 'm1'));
    inputRef.current.draft = 'edited prompt';
    setDraft.mockClear();
    await act(() => runtime.result.current.handleCancelRevert('s'));
    expect(setDraft).not.toHaveBeenCalledWith('');
  });

  it('keeps an attachment added after the revert when it is canceled', async () => {
    const { runtime, inputRef, setAttachments } = mount();
    await act(() => runtime.result.current.handleRevertMessage('s', 'm1'));
    inputRef.current.attachments = [...inputRef.current.attachments, { uri: 'data:text/plain;base64,YQ==' }];
    setAttachments.mockClear();
    await act(() => runtime.result.current.handleCancelRevert('s'));
    expect(setAttachments).not.toHaveBeenCalledWith([]);
  });

  it('moves a canceled pending prompt into an empty draft', async () => {
    const { runtime, inputRef, setDraft, cancelPrompt } = mount();
    inputRef.current.draft = '';
    await act(() => runtime.result.current.handleCancelPendingPrompt(prompt));
    expect(cancelPrompt).toHaveBeenCalledWith('s', 'm1');
    expect(setDraft).toHaveBeenCalledWith('prompt text');
  });

  it('does not overwrite a non-empty draft when a pending prompt is canceled', async () => {
    const { runtime, setDraft, cancelPrompt } = mount();
    await act(() => runtime.result.current.handleCancelPendingPrompt(prompt));
    expect(cancelPrompt).toHaveBeenCalledWith('s', 'm1');
    expect(setDraft).not.toHaveBeenCalled();
  });
});
