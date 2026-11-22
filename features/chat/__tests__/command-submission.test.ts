// @vitest-environment happy-dom

import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useComposerSubmission } from '@/features/chat/ui/use-composer-submission';
import { i18n } from '@/shared/i18n/index';
import type { PromptAttachment, PromptContextItem } from '@/shared/protocol/opencode/prompt-inbox';
import { renderHook } from '../../../tests/helpers/render-hook';
import { settleReact } from '../../../tests/helpers/controlled-clock';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en' }] }));

function controller(contract = 'v2') {
  const executeCommand = vi.fn<Parameters<typeof useComposerSubmission>[0]['executeCommand']>(async () => {});
  const sendPrompt = vi.fn(async () => true);
  const executeShell = vi.fn(async () => {});
  const snapshot = { draft: '', attachments: [] as PromptAttachment[], context: [] as PromptContextItem[],
    belongsHere: () => true, clear: vi.fn(), restore: vi.fn(() => true) };
  const driver = renderHook(() => {
    const [sendErrorMessage, setSendFeedback] = useState<string>();
    const { handleSendPrompt, closeSideQuestion, sideQuestion } = useComposerSubmission({
      hasActiveProject: true, connectionStatus: 'connected', currentSessionId: 's', isV2: contract === 'v2',
      shellCommandAvailable: true, commands: [], executeCommand, executeShell, sendPrompt,
      ensureActiveSession: async () => 's', capture: () => snapshot, clearRevertPrefill: () => {},
      setSendFeedback, t: i18n.t,
    });
    return { actions: { handleSendPrompt, closeSideQuestion }, overlay: { sideQuestion, sendErrorMessage } };
  }, undefined);
  async function send(draft: string) {
    await act(async () => { await driver.result.current.actions.handleSendPrompt(draft); });
  }
  return { driver, executeCommand, sendPrompt, executeShell, snapshot, send };
}

describe('slash submission', () => {
  it('sends a plugin command absent from the cached catalog, with files and exact arguments', async () => {
    const h = await controller();
    h.snapshot.attachments = [{ uri: 'data:text/plain;base64,YQ==' }];
    h.snapshot.context = [{ kind: 'agent', name: 'general', token: '@general' }];
    await h.send('/Plugin:Echo  "a b" @general\nnext  ');
    expect(h.executeCommand).toHaveBeenCalledWith('s', 'Plugin:Echo', ' "a b" @general\nnext  ', {
      attachments: h.snapshot.attachments, context: h.snapshot.context,
    });
    expect(h.sendPrompt).not.toHaveBeenCalled();
    h.driver.unmount();
  });

  it('blocks duplicate submissions and restores a failed command without prompt fallback', async () => {
    const h = await controller();
    let fail!: (error: Error) => void;
    h.executeCommand.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    let pending!: Promise<void>;
    act(() => { pending = h.driver.result.current.actions.handleSendPrompt('/missing args'); });
    await h.send('/missing args');
    expect(h.executeCommand).toHaveBeenCalledOnce();
    await act(async () => { fail(new Error('Command not found: missing')); await pending; });
    await settleReact();
    expect(h.snapshot.restore).toHaveBeenCalledWith('s');
    expect(h.driver.result.current.overlay.sendErrorMessage).toBe('Command not found: missing');
    expect(h.sendPrompt).not.toHaveBeenCalled();
    await h.send('/available');
    expect(h.executeCommand).toHaveBeenCalledTimes(2);
    h.driver.unmount();
  });

  it('preserves V1 unknown-command prompt behavior and V2 shell submission', async () => {
    const legacy = await controller('v1');
    await legacy.send('/unknown args');
    expect(legacy.executeCommand).not.toHaveBeenCalled();
    expect(legacy.sendPrompt).toHaveBeenCalledWith('s', '/unknown args', [], []);
    legacy.driver.unmount();
    const native = await controller();
    await native.send('!echo hi');
    expect(native.executeShell).toHaveBeenCalledWith('s', 'echo hi');
    expect(native.executeCommand).not.toHaveBeenCalled();
    native.driver.unmount();
  });

  it('opens the side question overlay with the generated answer', async () => {
    const h = await controller();
    h.executeCommand.mockResolvedValueOnce({ question: 'why?', answer: 'because' });
    await h.send('/btw why?');
    await settleReact();
    expect(h.executeCommand).toHaveBeenCalledWith('s', 'btw', 'why?', expect.objectContaining({ attachments: [], context: [] }));
    expect(h.driver.result.current.overlay.sideQuestion).toEqual({ question: 'why?', answer: 'because' });
    act(() => { h.driver.result.current.actions.closeSideQuestion(); });
    await settleReact();
    expect(h.driver.result.current.overlay.sideQuestion).toBeUndefined();
    h.driver.unmount();
  });
});
