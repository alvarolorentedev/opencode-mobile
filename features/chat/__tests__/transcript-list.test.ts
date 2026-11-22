// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { act } from 'react';
import { describe, expect, it, vi, onTestFinished } from 'vitest';

import { NoticeCard } from '@/features/chat/ui/chat-cards';
import { TranscriptList } from '@/features/chat/ui/content/transcript-list';
import { TranscriptSkeleton } from '@/features/chat/ui/content/transcript-skeleton';
import { Card } from '@/shared/ui/card';
import { Colors } from '@/shared/ui/theme/theme';
import { renderHook } from '../../../tests/helpers/render-hook';

const native = vi.hoisted(() => ({ platform: 'web' }));
vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform(native));
vi.mock('react-native-enriched-markdown', () => ({ EnrichedMarkdownText: 'EnrichedMarkdownText' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo-router', () => ({ useIsFocused: () => true, usePathname: () => '/' }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key === 'chat:reasoning.high' ? 'High' : key, i18n: { language: 'en' } }),
}));

const serialize = (value: unknown) => JSON.stringify(value, (key, entry) => key === '_owner' ? undefined : entry);

type Props = Parameters<typeof TranscriptList>[0];
type Overrides = Omit<Partial<Props>, 'transcriptRows'> & { transcriptRows?: unknown[] };
type Element = { type: unknown; props: Record<string, any> };

function listProps(overrides: Overrides = {}): Props {
  return {
    activityRunning: false,
    activityStatusLabel: undefined as string | undefined,
    connection: { status: 'connected' as const, message: '' },
    currentSessionId: 'session-1',
    transcriptRows: [],
    flatTranscript: false,
    hasMessages: false,
    hasOlderMessages: false,
    isBootstrappingChat: false,
    isLoadingOlderMessages: false,
    isRefreshingMessages: false,
    modelLabels: undefined as ReadonlyMap<string, string> | undefined,
    onCopyMessage: vi.fn(),
    onForkMessage: vi.fn(),
    onLoadOlderMessages: vi.fn(),
    onOpenSubagent: vi.fn(),
    onRetryTranscript: vi.fn(),
    onRevertMessage: vi.fn(),
    onSelectStarterPrompt: vi.fn(),
    onToggleSpeak: vi.fn(),
    palette: Colors.light,
    pendingInteractions: 0,
    slim: false,
    transcriptFontSize: 16,
    ...overrides,
  } as Props;
}

function mountTranscriptList(overrides: Overrides = {}, platform = 'web') {
  native.platform = platform;
  const frames = new Map<number, () => void>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  onTestFinished(() => { vi.unstubAllGlobals(); });
  const flushFrames = () => act(() => {
    while (frames.size) {
      const pending = [...frames.values()];
      frames.clear();
      for (const frame of pending) frame();
    }
  });
  let props = listProps(overrides);
  const runtime = renderHook(TranscriptList, props);
  const root = runtime.result.current as Element;
  const listOf = (value: Element): Element => value.type === 'FlashList' ? value : value.props.children[0];
  return {
    list: listOf(root),
    root,
    runtime,
    flushFrames,
    update: (patch: Overrides) => {
      props = listProps({ ...props, ...patch });
      runtime.rerender(props);
      return listOf(runtime.result.current as Element);
    },
  };
}

describe('Android transcript viewport', () => {
  const layout = (height: number) => ({ nativeEvent: { layout: { height } } });
  const scroll = (height: number, y: number) => ({
    nativeEvent: { contentOffset: { y }, contentSize: { height: 1200 }, layoutMeasurement: { height } },
  });

  async function mountAndroidTranscript() {
    const mounted = mountTranscriptList({ hasMessages: true, transcriptRows: [{ key: 'a' }] }, 'android');
    const scrollToEnd = vi.fn();
    mounted.list.props.ref.current = { scrollToEnd };
    mounted.flushFrames();
    scrollToEnd.mockClear();
    act(() => mounted.root.props.onLayout(layout(600)));
    mounted.flushFrames();
    expect(scrollToEnd).not.toHaveBeenCalled();
    return { ...mounted, scrollToEnd };
  }

  it('keeps the transcript at the end when the viewport shrinks without a scroll event or new rows', async () => {
    const { root, flushFrames, scrollToEnd } = await mountAndroidTranscript();
    act(() => root.props.onLayout(layout(340)));
    flushFrames();
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it('keeps following when scroll events report the smaller viewport before layout', async () => {
    const { list, root, runtime, flushFrames, scrollToEnd } = await mountAndroidTranscript();
    act(() => list.props.onScroll(scroll(600, 600)));
    act(() => list.props.onScroll(scroll(340, 600)));
    act(() => list.props.onScroll(scroll(340, 600)));
    act(() => root.props.onLayout(layout(340)));
    flushFrames();
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
    expect((runtime.result.current as Element).props.children[1]).toBeNull();
  });

  it('keeps the history position on a resize and still offers Jump to latest', async () => {
    const { list, root, runtime, flushFrames, scrollToEnd } = await mountAndroidTranscript();
    act(() => list.props.onScroll(scroll(600, 240)));
    act(() => root.props.onLayout(layout(340)));
    act(() => list.props.onScroll(scroll(340, 240)));
    flushFrames();
    expect(scrollToEnd).not.toHaveBeenCalled();
    expect(serialize((runtime.result.current as Element).props.children[1])).toContain('chat:content.jumpToLatest');
  });

  it('cancels a pending resize scroll when a gesture starts', async () => {
    const { list, root, flushFrames, scrollToEnd } = await mountAndroidTranscript();
    act(() => root.props.onLayout(layout(340)));
    act(() => list.props.onScrollBeginDrag());
    act(() => root.props.onLayout(layout(600)));
    act(() => list.props.onScrollEndDrag(scroll(600, 600)));
    flushFrames();
    expect(scrollToEnd).not.toHaveBeenCalled();
  });
});

describe('transcript empty state', () => {
  it('only offers starter prompts for a session that has no transcript content', async () => {
    const { list } = mountTranscriptList();
    expect(list.type).toBe('FlashList');
    expect(list.props.ListEmptyComponent.type).toBe(Card);
  });

  it('does not show the skeleton while a refresh has held records but no display content', async () => {
    const { update } = mountTranscriptList({ hasMessages: true, isRefreshingMessages: true });
    expect(update({}).props.ListEmptyComponent).toBeNull();
  });

  it('shows the skeleton only for a cold fetch with no held records', async () => {
    const { update } = mountTranscriptList({ hasMessages: false, isRefreshingMessages: true });
    expect(update({}).props.ListEmptyComponent.type).toBe(TranscriptSkeleton);
  });

  it('offers a retry instead of starter prompts when a cold read failed', async () => {
    const { update } = mountTranscriptList({ transcriptReadError: 'request timed out' });
    const list = update({});
    expect(list.props.ListEmptyComponent.type).toBe(Card);
    expect(serialize(list.props.ListEmptyComponent)).toContain('chat:content.transcriptErrorTitle');
    expect(serialize(list.props.ListEmptyComponent)).toContain('request timed out');
    expect(serialize(list.props.ListEmptyComponent)).not.toContain('chat:starter.title');
  });

  it('offers a load-earlier affordance when only non-display history is loaded', async () => {
    const { update } = mountTranscriptList({ hasOlderMessages: true });
    const idle = update({});
    expect(idle.props.ListEmptyComponent.type).toBe(Card);
    expect(serialize(idle.props.ListEmptyComponent)).toContain('chat:content.loadEarlier');
  });

  it('still offers starter prompts for a brand-new session', async () => {
    const { update } = mountTranscriptList({ currentSessionId: undefined });
    const list = update({ hasOlderMessages: false });
    expect(list.props.ListEmptyComponent.type).toBe(Card);
  });

  it('offers a jump-to-latest control after scrolling away and marks new activity', async () => {
    const { list, runtime, update } = mountTranscriptList({ hasMessages: true, transcriptRows: [{ key: 'a' }] });
    act(() => list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 1200 }, layoutMeasurement: { height: 600 } } }));
    expect(serialize((runtime.result.current as Element).props.children[1])).toContain('chat:content.jumpToLatest');

    update({ transcriptRows: [{ key: 'a' }, { key: 'b' }] });
    expect(serialize((runtime.result.current as Element).props.children[1])).toContain('chat:content.newMessages');
  });

  it('dismisses the jump-to-latest control when tapped', async () => {
    const { list, runtime, flushFrames } = mountTranscriptList({ hasMessages: true, transcriptRows: [{ key: 'a' }] });
    const scrollToEnd = vi.fn();
    list.props.ref.current = { scrollToEnd };
    act(() => list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 1200 }, layoutMeasurement: { height: 600 } } }));
    const control = (runtime.result.current as Element).props.children[1];
    act(() => control.props.children.props.onPress());
    flushFrames();
    expect((runtime.result.current as Element).props.children[1]).toBeNull();
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('leaves tail following to the transcript instead of FlashList autoscroll', async () => {
    const { list } = mountTranscriptList();
    expect(list.props.maintainVisibleContentPosition).toEqual({ startRenderingFromBottom: true });
  });

  it('does not chase the tail when new rows arrive during a drag, then resumes at the bottom', async () => {
    const { list, update, flushFrames } = mountTranscriptList({ hasMessages: true, transcriptRows: [{ key: 'a' }] });
    const scrollToEnd = vi.fn();
    list.props.ref.current = { scrollToEnd };
    const nearTail = { nativeEvent: { contentOffset: { y: 596 }, contentSize: { height: 1200 }, layoutMeasurement: { height: 600 } } };

    act(() => list.props.onScrollBeginDrag(nearTail));
    act(() => list.props.onScroll(nearTail));
    update({ transcriptRows: [{ key: 'a' }, { key: 'b' }] });
    flushFrames();
    expect(scrollToEnd).not.toHaveBeenCalled();

    act(() => list.props.onScrollEndDrag(nearTail));
    update({ transcriptRows: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] });
    flushFrames();
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('does not reserve a running-status footer', async () => {
    const { list } = mountTranscriptList();
    expect(list.props.ListFooterComponent).toBeUndefined();
  });

  it('appends a live status row in the activity area when requested', async () => {
    const idle = mountTranscriptList();
    expect(idle.list.props.data).toEqual([]);

    const { list } = mountTranscriptList({ activityStatusLabel: 'OpenCode is working…' });
    expect(list.props.data).toHaveLength(1);
    expect(list.props.data[0]).toMatchObject({ type: 'activityStatus', label: 'OpenCode is working…' });
    expect(serialize(list.props.renderItem({ item: list.props.data[0] }))).toContain('OpenCode is working…');
  });

  it('keeps expanded runs keyed to their group instead of a recycled row', async () => {
    const row = (key: string) => ({
      key: `activity:${key}`,
      type: 'activity' as const,
      group: { key, kind: 'activity' as const, items: [], tools: [], callCount: 0, status: 'idle' as const },
    });
    const { update, runtime } = mountTranscriptList({ transcriptRows: [row('g1')] });
    const header = (list: any, item: ReturnType<typeof row>) => list.props.renderItem({ item, index: 0 }).props.children.props;

    act(() => header((runtime.result.current as Element).props.children[0], row('g1')).onExpandedChange(true));
    expect(header((runtime.result.current as Element).props.children[0], row('g1')).expanded).toBe(true);

    const next = update({ transcriptRows: [row('g2')] });
    expect(header(next, row('g2')).expanded).toBe(false);
  });

  it('marks only the last activity row as the session-running anchor', async () => {
    const row = (key: string) => ({
      key: `activity:${key}`,
      type: 'activity' as const,
      group: { key, kind: 'activity' as const, items: [], tools: [], callCount: 0, status: 'idle' as const },
    });
    const rows = [row('a'), row('b')];
    const { list } = mountTranscriptList({ activityRunning: true, transcriptRows: rows });
    expect(serialize(list.props.renderItem({ item: rows[0] }))).toContain('"sessionRunning":false');
    expect(serialize(list.props.renderItem({ item: rows[1] }))).toContain('"sessionRunning":true');
  });

  it('does not offer read-aloud for server notice rows', async () => {
    const row = {
      key: 'message:notice',
      type: 'message' as const,
      entry: {
        id: 'notice',
        role: 'assistant' as const,
        createdAt: 0,
        text: 'No workflows found in .opencode/workflows.',
        details: [],
        notice: true,
      },
    };
    const { list } = mountTranscriptList({ transcriptRows: [row] });
    expect(serialize(list.props.renderItem({ item: row }))).toContain('"canSpeak":false');
  });

  it('renders plugin notices with the distinct notice card', async () => {
    const row = {
      key: 'message:plugin-notice',
      type: 'message' as const,
      entry: {
        id: 'plugin-notice',
        role: 'assistant' as const,
        createdAt: 0,
        text: '[OpenCode Quota report]',
        details: [],
        notice: true,
        noticeKind: 'plugin' as const,
      },
    };
    const { list } = mountTranscriptList({ transcriptRows: [row] });
    const rendered = list.props.renderItem({ item: row });
    expect(rendered.props.children.type).toBe(NoticeCard);
    expect(serialize(rendered)).not.toContain('"canSpeak"');
  });

  it('passes the resolved model label to assistant message rows', async () => {
    const row = {
      key: 'message:m1',
      type: 'message' as const,
      entry: {
        id: 'm1',
        role: 'assistant' as const,
        createdAt: 0,
        text: 'done',
        details: [],
        model: { providerID: 'openai', modelID: 'gpt-4.1-mini' },
      },
    };
    const { list } = mountTranscriptList({
      transcriptRows: [row],
      modelLabels: new Map([['openai/gpt-4.1-mini', 'GPT-4.1 mini']]),
    });
    expect(serialize(list.props.renderItem({ item: row }))).toContain('"modelLabel":"GPT-4.1 mini"');
  });

  it('includes the reasoning variant in the assistant model label', async () => {
    const row = {
      key: 'message:m1',
      type: 'message' as const,
      entry: {
        id: 'm1',
        role: 'assistant' as const,
        createdAt: 0,
        text: 'done',
        details: [],
        model: { providerID: 'openai', modelID: 'gpt-4.1-mini', variant: 'high' },
      },
    };
    const { list } = mountTranscriptList({
      transcriptRows: [row],
      modelLabels: new Map([['openai/gpt-4.1-mini', 'GPT-4.1 mini']]),
    });
    expect(serialize(list.props.renderItem({ item: row }))).toContain('"modelLabel":"GPT-4.1 mini · High"');
  });
});
