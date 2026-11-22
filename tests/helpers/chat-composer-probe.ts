import './native-primitives';
import { vi } from 'vitest';

import { ChatComposer } from '@/features/chat/ui/chat-composer';
import { defaultChatPreferences } from '@/shared/preferences/opencode-preferences';
import { Colors } from '@/shared/ui/theme/theme';
import { renderHook } from './render-hook';

vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

type Props = Parameters<typeof ChatComposer>[0];

export function chatComposerProbe(overrides: Partial<Props> = {}) {
  const props: Props = {
    attachments: [],
    availableAgents: [],
    chatPreferences: defaultChatPreferences,
    commands: [],
    connectionStatus: 'connected',
    conversation: { active: false, isListening: false, phase: 'off', readbackPhase: 'idle', wakePhrase: 'hey code', wakePhraseRequired: true },
    currentSessionId: 'session-1',
    draft: '',
    focusRequest: 0,
    isSpeechInputAvailable: false,
    isSpeechInputListening: false,
    isSpeechInputStarting: false,
    isStoppingSession: false,
    isUpdatingAutoApprove: false,
    onAttach: vi.fn(),
    onDraftChange: vi.fn(),
    onModelSelect: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onSelectionChange: vi.fn(),
    onSend: vi.fn(),
    onSuggestionSelect: vi.fn(),
    onToggleAutoApprove: async () => false,
    onToggleConversationMode: vi.fn(),
    onToggleRecording: vi.fn(),
    palette: Colors.light,
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
    ...overrides,
  };
  const runtime = renderHook(ChatComposer, props);
  return { ...runtime, update: (patch: Partial<Props> = {}) => runtime.rerender({ ...props, ...patch }) };
}
