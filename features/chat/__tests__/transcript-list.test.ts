import { uiImports } from '../../../tests/helpers/ui.mjs';
import { describe, expect, it, vi } from 'vitest';

import { getCurrentTurnActivityKey } from '@/features/chat/ui/chat-view-utils';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

type Overrides = Partial<Parameters<typeof listProps>[0]>;

function listProps(overrides: Record<string, unknown> = {}) {
  return {
    activityRunning: false,
    activityStatusLabel: undefined as string | undefined,
    connection: { status: 'connected' as const, message: '' },
    currentSessionId: 'session-1',
    transcriptRows: [] as unknown[],
    flatTranscript: false,
    hasMessages: false,
    hasOlderMessages: false,
    isLoadingOlderMessages: false,
    isRefreshingMessages: false,
    onCopyMessage: vi.fn(),
    onForkMessage: vi.fn(),
    onLoadOlderMessages: vi.fn(),
    onRetryTranscript: vi.fn(),
    onRevertMessage: vi.fn(),
    onSelectStarterPrompt: vi.fn(),
    onToggleSpeak: vi.fn(),
    palette: {},
    pendingInteractions: 0,
    slim: false,
    transcriptFontSize: 16,
    ...overrides,
  };
}

async function mountTranscriptList(overrides: Overrides = {}) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { TranscriptList } = await loadTs('features/chat/ui/content/transcript-list.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    '@shopify/flash-list': { FlashList: 'FlashList' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'expo-router': { useIsFocused: () => true },
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { AppState: { addEventListener: () => ({ remove: () => undefined }) }, View: 'View' },
    "@/features/chat/ui/cards/message-card": { TranscriptMessage: 'TranscriptMessage' },
    "@/features/chat/ui/cards/activity-group": { ActivityGroupRow: 'ActivityGroupRow' },
    "@/features/chat/ui/chat-view-styles": { styles: {}, slimStyles: {}, stylesClasses: {}, slimStylesClasses: {} },
    "@/features/chat/ui/chat-view-utils": { getCurrentTurnActivityKey, STARTER_PROMPT_KEYS: [] },
    "@/features/chat/ui/content/transcript-skeleton": { TranscriptSkeleton: 'TranscriptSkeleton' },
    "@/shared/ui/theme/theme": { Colors: { light: {} } }
  }, { ...runtime.globals, requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined });
  const root = runtime.mount(TranscriptList, listProps(overrides));
  const list = root.type === 'FlashList' ? root : root.props.children[0];
  return {
    list,
    root,
    runtime,
    update: (patch: Overrides) => {
      const next = runtime.update(patch as Record<string, unknown>);
      return next.type === 'FlashList' ? next : next.props.children[0];
    },
  };
}

describe('transcript empty state', () => {
  it('only offers starter prompts for a session that has no transcript content', async () => {
    const { list } = await mountTranscriptList();
    expect(list.type).toBe('FlashList');
    expect(list.props.ListEmptyComponent.type).toBe('Card');
  });

  it('does not show the skeleton while a refresh has held records but no display content', async () => {
    const { update } = await mountTranscriptList({ hasMessages: true, isRefreshingMessages: true });
    expect(update({}).props.ListEmptyComponent).toBeNull();
  });

  it('shows the skeleton only for a cold fetch with no held records', async () => {
    const { update } = await mountTranscriptList({ hasMessages: false, isRefreshingMessages: true });
    expect(update({}).props.ListEmptyComponent.type).toBe('TranscriptSkeleton');
  });

  it('offers a retry instead of starter prompts when a cold read failed', async () => {
    const { update } = await mountTranscriptList({ transcriptReadError: 'request timed out' });
    const list = update({});
    expect(list.props.ListEmptyComponent.type).toBe('Card');
    expect(JSON.stringify(list.props.ListEmptyComponent)).toContain('chat:content.transcriptErrorTitle');
    expect(JSON.stringify(list.props.ListEmptyComponent)).toContain('request timed out');
    expect(JSON.stringify(list.props.ListEmptyComponent)).not.toContain('chat:starter.title');
  });

  it('offers a load-earlier affordance when only non-display history is loaded', async () => {
    const { update } = await mountTranscriptList({ hasOlderMessages: true });
    const idle = update({});
    expect(idle.props.ListEmptyComponent.type).toBe('Card');
    expect(JSON.stringify(idle.props.ListEmptyComponent)).toContain('chat:content.loadEarlier');
  });

  it('still offers starter prompts for a brand-new session', async () => {
    const { update } = await mountTranscriptList({ currentSessionId: undefined });
    const list = update({ hasOlderMessages: false });
    expect(list.props.ListEmptyComponent.type).toBe('Card');
  });

  it('offers a jump-to-latest control after scrolling away and marks new activity', async () => {
    const { list, runtime, update } = await mountTranscriptList({ hasMessages: true, transcriptRows: [{ key: 'a' }] });
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 1200 }, layoutMeasurement: { height: 600 } } });
    runtime.flush();
    expect(JSON.stringify(runtime.value.props.children[1])).toContain('chat:content.jumpToLatest');

    update({ transcriptRows: [{ key: 'a' }, { key: 'b' }] });
    expect(JSON.stringify(runtime.value.props.children[1])).toContain('chat:content.newMessages');
  });

  it('dismisses the jump-to-latest control when tapped', async () => {
    const { list, runtime } = await mountTranscriptList({ hasMessages: true, transcriptRows: [{ key: 'a' }] });
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 1200 }, layoutMeasurement: { height: 600 } } });
    runtime.flush();
    const control = runtime.value.props.children[1];
    control.props.children.props.onPress();
    runtime.flush();
    expect(runtime.value.props.children[1]).toBeNull();
  });

  it('does not reserve a running-status footer', async () => {
    const { list } = await mountTranscriptList();
    expect(list.props.ListFooterComponent).toBeUndefined();
  });

  it('appends a live status row in the activity area when requested', async () => {
    const idle = await mountTranscriptList();
    expect(idle.list.props.data).toEqual([]);

    const { list } = await mountTranscriptList({ activityStatusLabel: 'OpenCode is working…' });
    expect(list.props.data).toHaveLength(1);
    expect(list.props.data[0]).toMatchObject({ type: 'activityStatus', label: 'OpenCode is working…' });
    expect(JSON.stringify(list.props.renderItem({ item: list.props.data[0] }))).toContain('OpenCode is working…');
  });

  it('marks only the last activity row as the session-running anchor', async () => {
    const row = (key: string) => ({
      key: `activity:${key}`,
      type: 'activity' as const,
      group: { key, kind: 'activity' as const, items: [], tools: [], callCount: 0, status: 'idle' as const },
    });
    const rows = [row('a'), row('b')];
    const { list } = await mountTranscriptList({ activityRunning: true, transcriptRows: rows });
    expect(JSON.stringify(list.props.renderItem({ item: rows[0] }))).toContain('"sessionRunning":false');
    expect(JSON.stringify(list.props.renderItem({ item: rows[1] }))).toContain('"sessionRunning":true');
  });
});
