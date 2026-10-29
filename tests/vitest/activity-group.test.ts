import { describe, expect, it } from 'vitest';

import * as transcript from '@/lib/opencode/transcript';
import { hookRuntime, loadTs, recyclingState } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: { children?: unknown; text?: string; selectable?: boolean; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string; accessibilityState?: { expanded?: boolean } } };

function find(node: unknown, type: string, out: Element[] = []) {
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

async function mountGroup(value: transcript.ActivityGroup, sessionRunning = false) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { ActivityGroupRow } = await loadTs('components/chat/cards/activity-group.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    '@shopify/flash-list': { useRecyclingState: recyclingState(runtime) },
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    'react-native': {
      Pressable: 'Pressable',
      StyleSheet: { create: (value: unknown) => value },
      View: 'View',
    },
    'react-native-paper': { ActivityIndicator: 'ActivityIndicator', Text: 'Text' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@/components/chat/cards/activity-item': { ActivityItemRow: 'ActivityItemRow', ActivityReadGroupRow: 'ActivityReadGroupRow' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/lib/opencode/format/tool-label': { getToolLabel: (name: string) => (name === 'read' ? 'Read' : name === 'bash' ? 'Shell' : name === 'patch' ? 'Patch' : name) },
    '@/lib/opencode/format': { getToolDisplayName: (name: string) => (name === 'bash' ? 'Shell' : name === 'read' ? 'Read' : name === 'edit' ? 'Edit' : name === 'patch' ? 'Patch' : name) },
    '@/lib/opencode/transcript': { buildActivityChildRows: transcript.buildActivityChildRows },
  }, runtime.globals);
  runtime.mount(ActivityGroupRow, { flat: false, fontSize: 16, group: value, palette: {}, sessionRunning });
  return runtime;
}

async function mountRead(reads: transcript.ToolDetail[]) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { ActivityReadGroupRow } = await loadTs('components/chat/cards/activity-item.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    '@shopify/flash-list': { useRecyclingState: recyclingState(runtime) },
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    'react-native': {
      Platform: { select: (options: Record<string, unknown>) => options.default },
      Pressable: 'Pressable',
      StyleSheet: { create: (value: unknown) => value },
      View: 'View',
    },
    'react-native-paper': { ActivityIndicator: 'ActivityIndicator', Text: 'Text' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'expo-clipboard': { setStringAsync: async () => undefined },
    '@/components/chat/cards/activity-diff': { ActivityDiffCard: 'ActivityDiffCard' },
    '@/components/chat/chat-markdown': { MarkdownText: 'MarkdownText' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/lib/haptics': { copyHaptic: () => undefined },
    '@/lib/opencode/format/tool-label': { getToolLabel: (name: string) => (name === 'read' ? 'Read' : name === 'bash' ? 'Shell' : name === 'patch' ? 'Patch' : name) },
    '@/lib/opencode/format': {
      formatDuration: (ms: number) => `${Math.round(ms / 1000)}s`,
      getToolDisplayName: (name: string) => (name === 'read' ? 'Read' : name === 'bash' ? 'Shell' : name),
      isFileChangeToolName: (name: string) => ['edit', 'write', 'patch', 'apply_patch', 'multiedit'].includes(name),
    },
    '@/lib/opencode/transcript': {
      isShellTool: (name: string) => name === 'bash',
    },
  }, runtime.globals);
  runtime.mount(ActivityReadGroupRow, { palette: {}, reads });
  return runtime;
}

async function mountItem(item: transcript.ActivityItem) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { ActivityItemRow } = await loadTs('components/chat/cards/activity-item.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    '@shopify/flash-list': { useRecyclingState: recyclingState(runtime) },
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    'react-native': {
      Platform: { select: (options: Record<string, unknown>) => options.default },
      Pressable: 'Pressable',
      StyleSheet: { create: (value: unknown) => value },
      View: 'View',
    },
    'react-native-paper': { ActivityIndicator: 'ActivityIndicator', Text: 'Text' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    'expo-clipboard': { setStringAsync: async () => undefined },
    '@/components/chat/cards/activity-diff': { ActivityDiffCard: 'ActivityDiffCard' },
    '@/components/chat/chat-markdown': { MarkdownText: 'MarkdownText' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/lib/haptics': { copyHaptic: () => undefined },
    '@/lib/opencode/format/tool-label': { getToolLabel: (name: string) => (name === 'read' ? 'Read' : name === 'bash' ? 'Shell' : name === 'patch' ? 'Patch' : name) },
    '@/lib/opencode/format': {
      formatDuration: (ms: number) => `${Math.round(ms / 1000)}s`,
      getToolDisplayName: (name: string) => (name === 'bash' ? 'Shell' : name),
      isFileChangeToolName: (name: string) => ['edit', 'write', 'patch', 'apply_patch', 'multiedit'].includes(name),
    },
    '@/lib/opencode/transcript': {
      isShellTool: (name: string) => name === 'bash',
    },
  }, runtime.globals);
  runtime.mount(ActivityItemRow, { fontSize: 16, item, palette: {} });
  return runtime;
}

describe('activity groups', () => {
  it('starts a completed run collapsed with a tool summary', async () => {
    const runtime = await mountGroup(group());
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'Used 3 Shell, Patch, Thought')).toBe(true);
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
    expect(find(runtime.value, 'Pressable')[0].props.accessibilityLabel).toContain('Expand activity');
  });

  it('expands the whole run at level one', async () => {
    const runtime = await mountGroup(group());
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(3);
  });

  it('stays collapsed while a tool is active and keeps the header progress circle', async () => {
    const runtime = await mountGroup(group({ status: 'running', items: [tool('t1', 'pnpm test', '', 'running')] }));
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
    expect(find(runtime.value, 'ActivityIndicator')).toHaveLength(1);
  });

  it('shows session progress on the last completed group without auto-expanding it', async () => {
    const runtime = await mountGroup(group(), true);
    expect(find(runtime.value, 'ActivityIndicator')).toHaveLength(1);
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
  });

  it('keeps a manual expansion after the run settles', async () => {
    const runtime = await mountGroup(group({ status: 'running', items: [tool('t1', 'pnpm test', '', 'running')] }));
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(1);
    runtime.update({ group: group({ status: 'idle', items: [tool('t1', 'pnpm test', ' M a.ts')] }) });
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(1);
  });

  it('keeps a manual collapse while the run is active', async () => {
    const runtime = await mountGroup(group({ status: 'running', items: [tool('t1', 'pnpm test', '', 'running')] }));
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(1);
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
    runtime.update({ group: group({ status: 'idle' }) });
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
  });

  it('does not carry expansion into a run that reuses the row', async () => {
    const runtime = await mountGroup(group());
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(3);
    runtime.update({ group: group({ key: 'g2' }) });
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
  });

  it('labels a reasoning-only run without a tool count', async () => {
    const runtime = await mountGroup(group({ callCount: 0, tools: [], items: [reasoning('r1'), reasoning('r2')] }));
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'Thought · 2')).toBe(true);
  });

  it('lists consecutive reads on one plain row without extra controls', async () => {
    const runtime = await mountGroup(group({
      callCount: 2,
      tools: [{ name: 'read', count: 2 }],
      items: [read('read-1', 'src/a.ts'), read('read-2', 'src/b.ts')],
    }));
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'Used 2 Read')).toBe(true);
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'ActivityReadGroupRow')).toHaveLength(1);
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
  });
});

describe('activity read rows', () => {
  it('shows clean filenames on one non-expandable line', async () => {
    const runtime = await mountRead([read('read-1', 'src/a.ts'), read('read-2', 'src/b.ts')]);
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'Read')).toBe(true);
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'a.ts, b.ts')).toBe(true);
    expect(find(runtime.value, 'Pressable')).toHaveLength(0);
  });
});

describe('activity items', () => {
  it('expands reasoning with its duration and markdown body', async () => {
    const runtime = await mountItem(reasoning('r1'));
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'Thought')).toBe(true);
    expect(find(runtime.value, 'Text').some((node) => node.props.children === '5s')).toBe(true);

    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'MarkdownText')[0]?.props.text).toBe('thinking');
  });

  it('shows the progress circle on the active child row', async () => {
    const runtime = await mountItem(tool('t1', 'pnpm test', '', 'running'));
    expect(find(runtime.value, 'ActivityIndicator')).toHaveLength(1);
  });

  it('renders a shell command and copyable output block', async () => {
    const runtime = await mountItem(tool('t1'));
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    const body = find(runtime.value, 'Text').find((node) => node.props.children === '$ git status --short\n M a.ts');
    expect(body?.props.selectable).toBe(true);
    expect(find(runtime.value, 'Pressable').some((node) => node.props.accessibilityLabel === 'common:actions.copy')).toBe(true);
    expect(find(runtime.value, 'MarkdownText')).toHaveLength(0);
  });

  it('shows grep as one non-expandable pattern and match line', async () => {
    const runtime = await mountItem({
      id: 'grep-1',
      kind: 'tool',
      tool: 'grep',
      label: 'grep',
      body: 'matches',
      status: 'completed',
      pattern: 'coalesce',
      matchCount: 7,
    });
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'pattern=coalesce')).toBe(true);
    expect(find(runtime.value, 'Text').some((node) => node.props.children === '· (7 matches)')).toBe(true);
    expect(find(runtime.value, 'Pressable')[0].props.disabled).toBe(true);
  });

  it('renders resolved edit files as expandable diff cards', async () => {
    const runtime = await mountItem({
      id: 'edit-1',
      kind: 'tool',
      tool: 'edit',
      label: 'edit',
      body: '',
      status: 'completed',
      path: 'src/a.ts',
      files: [{ file: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 }],
    });
    expect(find(runtime.value, 'ActivityDiffCard')).toHaveLength(1);
  });

  it('lists changed files for a patch row', async () => {
    const runtime = await mountItem(patch);
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    const files = find(runtime.value, 'Text').filter((node) => node.props.selectable);
    expect(files.map((node) => node.props.children)).toEqual(['a.ts', 'b.ts']);
  });

  it('does not make an empty tool row expandable', async () => {
    const runtime = await mountItem({ id: 't1', kind: 'tool', tool: 'read', label: 'read', body: 'No output', status: 'completed' });
    expect(find(runtime.value, 'Pressable')[0].props.disabled).toBe(true);
  });

  it('resets expansion when the row is recycled to another item', async () => {
    const runtime = await mountItem(tool('t1'));
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'Text').some((node) => node.props.children === '$ git status --short\n M a.ts')).toBe(true);

    runtime.update({ item: tool('t2') });
    expect(find(runtime.value, 'Text').some((node) => node.props.children === '$ git status --short\n M a.ts')).toBe(false);
    expect(find(runtime.value, 'Pressable')[0].props.accessibilityState).toEqual({ expanded: false });
  });
});
