import { describe, expect, it, vi } from 'vitest';
import { getInitialMode } from '@/features/ai/model/opencode-model-selection';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

async function controller(contract = 'v2') {
  const driver = hookRuntime();
  const executeCommand = vi.fn(async (..._args: unknown[]): Promise<{ question: string; answer: string } | void> => {});
  const sendPrompt = vi.fn(async () => true);
  const executeShell = vi.fn(async () => {});
  const snapshot = { draft: '', attachments: [] as object[], context: [] as object[],
    belongsHere: () => true, clear: vi.fn(), restore: vi.fn(() => true) };
  const noop = () => {};
  const { useChatViewController } = await loadTs('features/chat/ui/use-chat-view-controller.ts', {
    react: driver.react,
    'expo-router': { usePathname: () => '/' },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { Keyboard: { dismiss: noop } },
    '@/shared/platform/clipboard': {}, '@/shared/platform/haptics': { copyHaptic: noop },
    '@/runtime/ui': { useUpdateBlocker: noop },
    '@/shared/presentation/transcript': { buildTranscriptRows: () => [], getTurnPatchDetails: () => [] },
    '@/shared/presentation/usage': { getLatestContextTokens: () => 0 },
    '@/features/sharing/index': {},
    '@/features/ai/index': { getInitialMode, getSelectedModelVariant: noop, getVisibleModels: () => [] },
    '@/features/ai/context': { useCapabilities: () => ({ availableAgents: [], availableModels: [], modelRouting: {} }) },
    '@/features/chat/context': { useChat: () => ({
      executeCommand, executeShell, sendPrompt, commands: [], pendingPrompts: [], currentDiffs: [], currentMessages: [],
      currentPendingPermissions: [], currentPendingQuestions: [], currentTodos: [], currentTranscript: [],
      sendingState: {}, sharedInput: {}, availableSkills: [], availableReferences: [],
    }) },
    '@/features/connections/context': { useConnection: () => ({ connection: { status: 'connected' },
      settings: { serverUrl: 'http://test', username: '', password: '' }, serverCapabilities: { contract, shellCommand: true } }) },
    '@/features/sessions/context': { useCurrentSession: () => ({ currentSessionId: 's' }),
      useSessionLibrary: () => ({ sessionStatuses: {}, sessions: [] }), useApprovals: () => ({}) },
    '@/features/projects/context': { useProjects: () => ({ activeProject: { path: '/repo' } }) },
    '@/features/voice/context': { useConversation: () => ({ conversation: {} }) },
    '@/features/updates/context': { useUpdates: () => ({}) },
    '@/shared/preferences/context': { usePreferences: () => ({ chatPreferences: { autoModel: {} } }) },
    '@/features/chat/ui/use-chat-draft': { useChatDraft: () => ({ draft: '', attachments: [], context: [],
      capture: () => snapshot, inputRef: { current: snapshot } }) },
    '@/features/chat/ui/use-chat-composer-notices': { useChatComposerNotices: () => ({}) },
    '@/features/chat/ui/use-chat-view-actions': { useChatViewActions: () => ({}) },
    '@/features/chat/ui/use-chat-view-voice': { useChatViewVoice: () => ({}) },
  }, { Error });
  driver.mount(useChatViewController, {});
  return { driver, executeCommand, sendPrompt, executeShell, snapshot };
}

describe('slash submission', () => {
  it('sends a plugin command absent from the cached catalog, with files and exact arguments', async () => {
    const h = await controller();
    h.snapshot.attachments = [{ uri: 'data:text/plain;base64,YQ==' }];
    h.snapshot.context = [{ kind: 'agent', name: 'general', token: '@general' }];
    await h.driver.value.actions.handleSendPrompt('/Plugin:Echo  "a b" @general\nnext  ');
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
    const pending = h.driver.value.actions.handleSendPrompt('/missing args');
    await h.driver.value.actions.handleSendPrompt('/missing args');
    expect(h.executeCommand).toHaveBeenCalledOnce();
    fail(new Error('Command not found: missing'));
    await pending;
    h.driver.flush();
    expect(h.snapshot.restore).toHaveBeenCalledWith('s');
    expect(h.driver.value.overlay.sendErrorMessage).toBe('Command not found: missing');
    expect(h.sendPrompt).not.toHaveBeenCalled();
    await h.driver.value.actions.handleSendPrompt('/available');
    expect(h.executeCommand).toHaveBeenCalledTimes(2);
    h.driver.unmount();
  });

  it('preserves V1 unknown-command prompt behavior and V2 shell submission', async () => {
    const legacy = await controller('v1');
    await legacy.driver.value.actions.handleSendPrompt('/unknown args');
    expect(legacy.executeCommand).not.toHaveBeenCalled();
    expect(legacy.sendPrompt).toHaveBeenCalledWith('s', '/unknown args', [], []);
    legacy.driver.unmount();
    const native = await controller();
    await native.driver.value.actions.handleSendPrompt('!echo hi');
    expect(native.executeShell).toHaveBeenCalledWith('s', 'echo hi');
    expect(native.executeCommand).not.toHaveBeenCalled();
    native.driver.unmount();
  });

  it('opens the side question overlay with the generated answer', async () => {
    const h = await controller();
    h.executeCommand.mockResolvedValueOnce({ question: 'why?', answer: 'because' });
    await h.driver.value.actions.handleSendPrompt('/btw why?');
    h.driver.flush();
    expect(h.executeCommand).toHaveBeenCalledWith('s', 'btw', 'why?', expect.objectContaining({ attachments: [], context: [] }));
    expect(h.driver.value.overlay.sideQuestion).toEqual({ question: 'why?', answer: 'because' });
    h.driver.value.actions.closeSideQuestion();
    h.driver.flush();
    expect(h.driver.value.overlay.sideQuestion).toBeUndefined();
    h.driver.unmount();
  });
});
