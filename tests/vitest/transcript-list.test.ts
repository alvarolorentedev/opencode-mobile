import { describe, expect, it, vi } from 'vitest';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Overrides = Partial<Parameters<typeof listProps>[0]>;

function listProps(overrides: Record<string, unknown> = {}) {
  return {
    activeSession: undefined,
    awaitingUserInput: false,
    connection: { status: 'connected' as const, message: '' },
    currentSessionId: 'session-1',
    displayTranscript: [] as unknown[],
    flatTranscript: false,
    hasMessages: false,
    hasOlderMessages: false,
    isLoadingOlderMessages: false,
    isRefreshingMessages: false,
    onCopyMessage: vi.fn(),
    onForkMessage: vi.fn(),
    onLoadOlderMessages: vi.fn(),
    onReviewChanges: vi.fn(),
    onRevertMessage: vi.fn(),
    onSelectStarterPrompt: vi.fn(),
    onToggleSpeak: vi.fn(),
    onUnrevert: vi.fn(),
    palette: {},
    pendingInteractions: 0,
    running: false,
    slim: false,
    transcriptFontSize: 16,
    ...overrides,
  };
}

async function mountTranscriptList(overrides: Overrides = {}) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { TranscriptList } = await loadTs('components/chat/content/transcript-list.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    '@shopify/flash-list': { FlashList: 'FlashList' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'expo-router': { useIsFocused: () => true },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { AppState: { addEventListener: () => ({ remove: () => undefined }) }, View: 'View' },
    'react-native-paper': { ActivityIndicator: 'ActivityIndicator', Button: 'Button', Card: 'Card', Text: 'Text', TouchableRipple: 'TouchableRipple' },
    '@/components/chat/chat-cards': { TranscriptMessage: 'TranscriptMessage' },
    '@/components/chat/chat-view-styles': { styles: {}, slimStyles: {} },
    '@/components/chat/chat-view-utils': { STARTER_PROMPT_KEYS: [] },
    '@/components/chat/content/transcript-skeleton': { TranscriptSkeleton: 'TranscriptSkeleton' },
    '@/constants/theme': { Colors: { light: {} } },
  }, { ...runtime.globals, requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined });
  const list = runtime.mount(TranscriptList, listProps(overrides));
  return {
    list,
    update: (patch: Overrides) => {
      runtime.update(patch as Record<string, unknown>);
      return runtime.value;
    },
  };
}

describe('transcript empty state', () => {
  it('only offers starter prompts for a session that has no transcript content', async () => {
    const { list } = await mountTranscriptList();
    expect(list.type).toBe('FlashList');
    expect(list.props.ListEmptyComponent.type).toBe('Card');
  });

  it('does not show the skeleton while a running turn has held records but no display content', async () => {
    const { update } = await mountTranscriptList({ hasMessages: true, isRefreshingMessages: true, running: true });
    expect(update({}).props.ListEmptyComponent).toBeNull();
  });

  it('shows the skeleton only for a cold fetch with no held records', async () => {
    const { update } = await mountTranscriptList({ hasMessages: false, isRefreshingMessages: true, running: true });
    expect(update({}).props.ListEmptyComponent.type).toBe('TranscriptSkeleton');
  });

  it('does not offer starter prompts when only non-display history is loaded', async () => {
    const { update } = await mountTranscriptList({ hasOlderMessages: true });
    const idle = update({ running: false });
    expect(idle.props.ListEmptyComponent).toBeNull();
  });

  it('still offers starter prompts for a brand-new session', async () => {
    const { update } = await mountTranscriptList({ currentSessionId: undefined });
    const list = update({ hasOlderMessages: false });
    expect(list.props.ListEmptyComponent.type).toBe('Card');
  });
});
