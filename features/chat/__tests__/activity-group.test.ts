// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ActivityDiffCard } from '@/features/chat/ui/cards/activity-diff';
import { ActivityGroupRow } from '@/features/chat/ui/cards/activity-group';
import { ActivityItemRow, ActivityReadGroupRow } from '@/features/chat/ui/cards/activity-item';
import { MarkdownText } from '@/features/chat/ui/chat-markdown';
import * as transcript from '@/shared/presentation/transcript';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
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
  ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
}));

type Element = { type: unknown; props: { children?: unknown; text?: string; selectable?: boolean; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string; accessibilityLiveRegion?: string; accessibilityState?: { expanded?: boolean }; testID?: string } };

function find(node: unknown, type: unknown, out: Element[] = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => find(child, type, out));
    return out;
  }
  const element = node as Element;
  if (element.type === type) out.push(element);
  if (element.props?.children !== undefined) find(element.props.children, type, out);
  return out;
}

function translate(key: string, values: Record<string, unknown> = {}) {
  const toolLabels: Record<string, string> = { 'chat:tools.read': 'Read', 'chat:tools.shell': 'Shell', 'chat:tools.edit': 'Edit', 'chat:tools.patch': 'Patch' };
  if (toolLabels[key]) return toolLabels[key];
  if (key === 'chat:activity.used') return `Used ${values.count} ${values.tools}`;
  if (key === 'chat:activity.thought') return 'Thought';
  if (key === 'chat:activity.thoughtCount') return `Thought · ${values.count}`;
  if (key === 'chat:activity.expandActivity') return 'Expand activity';
  if (key === 'chat:activity.collapseActivity') return 'Collapse activity';
  if (key === 'chat:activity.expandItem') return `Expand ${values.item}`;
  if (key === 'chat:activity.collapseItem') return `Collapse ${values.item}`;
  if (key === 'chat:activity.matches') return `· (${values.count} matches)`;
  if (key === 'chat:diff.filesChangedSimple') return `${values.files} files changed`;
  return key;
}

const tool = (id: string, command = 'git status --short', body = ' M a.ts', status = 'completed'): transcript.ToolDetail => ({
  id,
  kind: 'tool',
  tool: 'bash',
  command,
  label: 'bash',
  body,
  status,
});

const reasoning = (id: string): transcript.ReasoningDetail => ({
  id,
  kind: 'reasoning',
  label: 'Reasoning',
  body: 'thinking',
  durationMs: 5000,
});

const patch: transcript.PatchDetail = { id: 'p1', kind: 'patch', label: 'Patch 2 files', body: 'a.ts\nb.ts' };

const read = (id: string, path: string): transcript.ToolDetail => ({
  id,
  kind: 'tool',
  tool: 'read',
  label: 'read',
  body: '',
  status: 'completed',
  path,
});

const group = (overrides: Partial<transcript.ActivityGroup> = {}): transcript.ActivityGroup => ({
  key: 'g1',
  kind: 'activity',
  callCount: 3,
  status: 'idle',
  tools: [{ name: 'bash', count: 2 }, { name: 'edit', count: 1 }],
  items: [reasoning('r1'), tool('t1'), patch],
  ...overrides,
});

function mountGroup(value: transcript.ActivityGroup, sessionRunning = false, statusLabel?: string) {
  let props: Parameters<typeof ActivityGroupRow>[0] = {
    expanded: false, flat: false, fontSize: 16, group: value, onExpandedChange: (expanded) => update({ expanded }),
    palette: Colors.light, sessionRunning, statusLabel,
  };
  const runtime = renderHook(ActivityGroupRow, props);
  function update(patch: Partial<typeof props>) {
    props = { ...props, ...patch };
    runtime.rerender(props);
  }
  return { ...runtime, update };
}

function mountRead(reads: transcript.ToolDetail[]) {
  return renderHook(ActivityReadGroupRow, { palette: Colors.light, reads });
}

function mountItem(item: transcript.ActivityItem) {
  const props = { fontSize: 16, item, palette: Colors.light };
  const runtime = renderHook(ActivityItemRow, props);
  return { ...runtime, update: (patch: Partial<typeof props>) => runtime.rerender({ ...props, ...patch }) };
}

describe('activity groups', () => {
  it('starts a completed run collapsed with a tool summary', async () => {
    const runtime = mountGroup(group());
    expect(find(runtime.result.current, Text).some((node) => node.props.children === 'Used 3 Shell, Patch, Thought')).toBe(true);
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(0);
    expect(find(runtime.result.current, 'Pressable')[0].props.accessibilityLabel).toContain('Expand activity');
  });

  it('expands the whole run at level one', async () => {
    const runtime = mountGroup(group());
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(3);
  });

  it('stays collapsed while a tool is active and keeps the header progress circle', async () => {
    const runtime = mountGroup(group({ status: 'running', items: [tool('t1', 'pnpm test', '', 'running')] }));
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(0);
    expect(find(runtime.result.current, Spinner)).toHaveLength(1);
  });

  it('shows session progress on the last completed group without auto-expanding it', async () => {
    const runtime = mountGroup(group(), true);
    expect(find(runtime.result.current, Spinner)).toHaveLength(1);
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(0);
  });

  it('renders a non-interactive live status row with the supplied label', async () => {
    const runtime = mountGroup(group({ key: 'session-status', callCount: 0, tools: [], items: [], status: 'running' }), false, 'OpenCode is working…');
    expect(find(runtime.result.current, Text).some((node) => node.props.children === 'OpenCode is working…')).toBe(true);
    expect(find(runtime.result.current, Spinner)).toHaveLength(1);
    expect(find(runtime.result.current, 'Pressable')).toHaveLength(0);
    expect(find(runtime.result.current, 'View').some((node) => node.props.testID === 'transcript-activity-session-status'
      && node.props.accessibilityLiveRegion === 'polite')).toBe(true);
  });

  it('keeps a manual expansion after the run settles', async () => {
    const runtime = mountGroup(group({ status: 'running', items: [tool('t1', 'pnpm test', '', 'running')] }));
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(1);
    runtime.update({ group: group({ status: 'idle', items: [tool('t1', 'pnpm test', ' M a.ts')] }) });
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(1);
  });

  it('keeps a manual collapse while the run is active', async () => {
    const runtime = mountGroup(group({ status: 'running', items: [tool('t1', 'pnpm test', '', 'running')] }));
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(1);
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(0);
    runtime.update({ group: group({ status: 'idle' }) });
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(0);
  });

  it('renders only the level-one header for a pinned copy', async () => {
    const runtime = mountGroup(group());
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    runtime.update({ expanded: true, headerOnly: true, pinned: true });
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(0);
    expect(find(runtime.result.current, 'Pressable')[0].props.testID).toBe('transcript-sticky-activity-g1');
  });

  it('labels a reasoning-only run without a tool count', async () => {
    const runtime = mountGroup(group({ callCount: 0, tools: [], items: [reasoning('r1'), reasoning('r2')] }));
    expect(find(runtime.result.current, Text).some((node) => node.props.children === 'Thought · 2')).toBe(true);
  });

  it('lists consecutive reads on one plain row without extra controls', async () => {
    const runtime = mountGroup(group({
      callCount: 2,
      tools: [{ name: 'read', count: 2 }],
      items: [read('read-1', 'src/a.ts'), read('read-2', 'src/b.ts')],
    }));
    expect(find(runtime.result.current, Text).some((node) => node.props.children === 'Used 2 Read')).toBe(true);
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    expect(find(runtime.result.current, ActivityReadGroupRow)).toHaveLength(1);
    expect(find(runtime.result.current, ActivityItemRow)).toHaveLength(0);
  });
});

describe('activity read rows', () => {
  it('shows clean filenames on one non-expandable line', async () => {
    const runtime = mountRead([read('read-1', 'src/a.ts'), read('read-2', 'src/b.ts')]);
    expect(find(runtime.result.current, Text).some((node) => node.props.children === 'Read')).toBe(true);
    expect(find(runtime.result.current, Text).some((node) => node.props.children === 'a.ts, b.ts')).toBe(true);
    expect(find(runtime.result.current, 'Pressable')).toHaveLength(0);
  });
});

describe('activity items', () => {
  it('expands reasoning with its duration and markdown body', async () => {
    const runtime = mountItem(reasoning('r1'));
    expect(find(runtime.result.current, Text).some((node) => node.props.children === 'Thought')).toBe(true);
    expect(find(runtime.result.current, Text).some((node) => node.props.children === '5s')).toBe(true);

    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    expect(find(runtime.result.current, MarkdownText)[0]?.props.text).toBe('thinking');
  });

  it('shows the progress circle on the active child row', async () => {
    const runtime = mountItem(tool('t1', 'pnpm test', '', 'running'));
    expect(find(runtime.result.current, Spinner)).toHaveLength(1);
  });

  it('renders a shell command and copyable output block', async () => {
    const runtime = mountItem(tool('t1'));
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    const body = find(runtime.result.current, Text).find((node) => node.props.children === '$ git status --short\n M a.ts');
    expect(body?.props.selectable).toBe(true);
    expect(find(runtime.result.current, 'Pressable').some((node) => node.props.accessibilityLabel === 'common:actions.copy')).toBe(true);
    expect(find(runtime.result.current, MarkdownText)).toHaveLength(0);
  });

  it('shows grep as one non-expandable pattern and match line', async () => {
    const runtime = mountItem({
      id: 'grep-1',
      kind: 'tool',
      tool: 'grep',
      label: 'grep',
      body: 'matches',
      status: 'completed',
      pattern: 'coalesce',
      matchCount: 7,
    });
    expect(find(runtime.result.current, Text).some((node) => node.props.children === 'pattern=coalesce')).toBe(true);
    expect(find(runtime.result.current, Text).some((node) => node.props.children === '· (7 matches)')).toBe(true);
    expect(find(runtime.result.current, 'Pressable')[0].props.disabled).toBe(true);
  });

  it('renders resolved edit files as expandable diff cards', async () => {
    const runtime = mountItem({
      id: 'edit-1',
      kind: 'tool',
      tool: 'edit',
      label: 'edit',
      body: '',
      status: 'completed',
      path: 'src/a.ts',
      files: [{ file: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 }],
    });
    expect(find(runtime.result.current, ActivityDiffCard)).toHaveLength(1);
  });

  it('lists changed files for a patch row', async () => {
    const runtime = mountItem(patch);
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    const files = find(runtime.result.current, Text).filter((node) => node.props.selectable);
    expect(files.map((node) => node.props.children)).toEqual(['a.ts', 'b.ts']);
  });

  it('does not make an empty tool row expandable', async () => {
    const runtime = mountItem({ id: 't1', kind: 'tool', tool: 'read', label: 'read', body: 'No output', status: 'completed' });
    expect(find(runtime.result.current, 'Pressable')[0].props.disabled).toBe(true);
  });

  it('resets expansion when the row is recycled to another item', async () => {
    const runtime = mountItem(tool('t1'));
    act(() => find(runtime.result.current, 'Pressable')[0].props.onPress?.());
    expect(find(runtime.result.current, Text).some((node) => node.props.children === '$ git status --short\n M a.ts')).toBe(true);

    runtime.update({ item: tool('t2') });
    expect(find(runtime.result.current, Text).some((node) => node.props.children === '$ git status --short\n M a.ts')).toBe(false);
    expect(find(runtime.result.current, 'Pressable')[0].props.accessibilityState).toEqual({ expanded: false });
  });
});
