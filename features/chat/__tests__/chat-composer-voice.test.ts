import { uiImports } from '../../../tests/helpers/ui.mjs';
import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
const element = (type: unknown, props: Element['props']) => ({ type, props });
const jsx = { jsx: element, jsxs: element };
const native = {
  Keyboard: { dismiss: vi.fn() },
  Platform: { OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ fontScale: 1, height: 844 }),
  View: 'View',
};

function find(root: Element, testID: string): Element | undefined {
  if (root?.props?.testID === testID) return root;
  for (const child of [root?.props?.children].flat(Infinity)) {
    if (child && typeof child === 'object') {
      const match = find(child, testID);
      if (match) return match;
    }
  }
}

const viewStyles = await loadTs('features/chat/ui/chat-view-styles.ts', {
  ...uiImports,
  'react-native': native,
  '@/shared/ui/theme/theme': { Fonts: { sans: 'Avenir Next', display: 'Avenir Next' } },
});

async function mount({ conversationActive = false, isSpeechInputAvailable = false, voiceWakeMode = 'local' }: {
  conversationActive?: boolean;
  isSpeechInputAvailable?: boolean;
  voiceWakeMode?: 'local' | 'phrase';
}) {
  const runtime = hookRuntime();
  const { ChatComposer } = await loadTs('features/chat/ui/chat-composer.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': jsx,
    'react-native': native,
    '@/features/chat/ui/chat-view-styles': viewStyles,
    '@/features/chat/ui/chat-prompt-input': { ChatPromptInput: 'ChatPromptInput' },
    '@/features/chat/ui/agent-picker': { AgentPicker: 'AgentPicker' },
    '@/features/ai/ui/model-picker': { ModelPicker: 'ModelPicker' },
    '@/features/chat/ui/composer-suggestions': { ComposerSuggestions: 'ComposerSuggestions' },
    '@/features/sharing/ui/attachment-strip': { AttachmentStrip: 'AttachmentStrip' },
    '@/features/chat/ui/chat-view-utils': { getAutoApproveIcon: () => 'shield' },
    '@/shared/ui/theme/color': { withAlpha: (color: string) => color },
  });
  runtime.mount(ChatComposer, {
    attachments: [],
    availableAgents: [],
    chatPreferences: { recentModelIds: [], voiceWakeMode },
    commands: [],
    connectionStatus: 'connected',
    conversation: { active: conversationActive, isListening: false, phase: conversationActive ? 'armed' : 'off', readbackPhase: 'idle', wakePhrase: 'hey code', wakePhraseRequired: true },
    currentSessionId: 'session-1',
    draft: '',
    focusRequest: 0,
    isSpeechInputAvailable,
    isSpeechInputListening: false,
    isSpeechInputStarting: false,
    isStoppingSession: false,
    isUpdatingAutoApprove: false,
    onAttach: vi.fn(),
    onDraftChange: vi.fn(),
    onModelSelect: vi.fn(),
    onModelVariantChange: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onSelectionChange: vi.fn(),
    onSend: vi.fn(),
    onSuggestionSelect: vi.fn(),
    onToggleAutoApprove: async () => false,
    onToggleConversationMode: vi.fn(),
    onToggleRecording: vi.fn(),
    palette: { muted: '#666', surfaceAlt: '#fff', text: '#000', tint: '#000' },
    selectedAgentLabel: 'Build',
    agentsLoading: false,
    showSendAction: true,
    autoRoutingAvailable: false,
    autoRoutingEnabled: false,
    onAutoRoutingChange: vi.fn(),
    visibleModels: [],
    updateChatPreferences: vi.fn(),
    isV2: true,
    suggestions: [],
    suggestionsActive: false,
    suggestionsSearching: false,
    shellMode: false,
  });
  return runtime;
}

describe('composer voice availability', () => {
  it('starts conversation mode from on-device voice without a system recognizer', async () => {
    const runtime = await mount({ voiceWakeMode: 'local' });
    expect(find(runtime.value, 'chat-primary-button')?.props.disabled).toBe(false);
    expect(find(runtime.value, 'chat-secondary-button')?.props.disabled).toBe(true);
  });

  it('keeps conversation mode disabled when only the missing system recognizer is selected', async () => {
    const runtime = await mount({ voiceWakeMode: 'phrase' });
    expect(find(runtime.value, 'chat-primary-button')?.props.disabled).toBe(true);
    expect(find(runtime.value, 'chat-secondary-button')?.props.disabled).toBe(true);
  });

  it('keeps dictation and conversation available when the system recognizer exists', async () => {
    const runtime = await mount({ isSpeechInputAvailable: true, voiceWakeMode: 'phrase' });
    expect(find(runtime.value, 'chat-primary-button')?.props.disabled).toBe(false);
    expect(find(runtime.value, 'chat-secondary-button')?.props.disabled).toBe(false);
  });

  it('can stop an active on-device conversation without a system recognizer', async () => {
    const runtime = await mount({ conversationActive: true, voiceWakeMode: 'local' });
    expect(find(runtime.value, 'chat-primary-button')?.props.disabled).toBe(false);
  });
});
