import { describe, expect, it } from 'vitest';

import * as transcript from '@/lib/opencode/transcript';
import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: { children?: unknown; text?: string; selectable?: boolean; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string } };

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
  if (key === 'chat:cards.filesChangedSimple') return `${values.files} files changed`;
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

const group = (overrides: Partial<transcript.ActivityGroup> = {}): transcript.ActivityGroup => ({
  key: 'g1',
  kind: 'activity',
  callCount: 3,
  status: 'idle',
  tools: [{ name: 'bash', count: 2 }, { name: 'edit', count: 1 }],
  items: [reasoning('r1'), tool('t1'), patch],
  ...overrides,
});

async function mountGroup(value: transcript.ActivityGroup) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { ActivityGroupRow } = await loadTs('components/chat/cards/activity-group.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    'react-native': {
      Pressable: 'Pressable',
      StyleSheet: { create: (value: unknown) => value },
      View: 'View',
    },
    'react-native-paper': { ActivityIndicator: 'ActivityIndicator', Text: 'Text' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@/components/chat/cards/activity-item': { ActivityItemRow: 'ActivityItemRow' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/lib/opencode/format': { getToolDisplayName: (name: string) => (name === 'bash' ? 'Shell' : name === 'edit' ? 'Edit' : name) },
  }, runtime.globals);
  runtime.mount(ActivityGroupRow, { flat: false, fontSize: 16, group: value, palette: {} });
  return runtime;
}

async function mountItem(item: transcript.ActivityItem) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { ActivityItemRow } = await loadTs('components/chat/cards/activity-item.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    'react-native': {
      Platform: { select: (options: Record<string, unknown>) => options.default },
      Pressable: 'Pressable',
      StyleSheet: { create: (value: unknown) => value },
      View: 'View',
    },
    'react-native-paper': { Text: 'Text' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@/components/chat/chat-markdown': { MarkdownText: 'MarkdownText' },
    '@/constants/theme': { Colors: { light: {} } },
    '@/lib/opencode/format': {
      formatDuration: (ms: number) => `${Math.round(ms / 1000)}s`,
      getToolDisplayName: (name: string) => (name === 'bash' ? 'Shell' : name),
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
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'Used 3 Shell, Edit')).toBe(true);
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
    expect(find(runtime.value, 'Pressable')[0].props.accessibilityLabel).toContain('Expand activity');
  });

  it('expands the whole run at level one', async () => {
    const runtime = await mountGroup(group());
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(3);
  });

  it('auto-opens while a tool is active', async () => {
    const runtime = await mountGroup(group({ status: 'running', items: [tool('t1', 'pnpm test', '', 'running')] }));
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(1);
  });

  it('keeps a manual collapse after the run settles', async () => {
    const runtime = await mountGroup(group({ status: 'running', items: [tool('t1', 'pnpm test', '', 'running')] }));
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
    runtime.update({ group: group({ status: 'idle' }) });
    expect(find(runtime.value, 'ActivityItemRow')).toHaveLength(0);
  });

  it('labels a reasoning-only run without a tool count', async () => {
    const runtime = await mountGroup(group({ callCount: 0, tools: [], items: [reasoning('r1'), reasoning('r2')] }));
    expect(find(runtime.value, 'Text').some((node) => node.props.children === 'Thought · 2')).toBe(true);
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

  it('renders a shell command and output as one non-copyable block', async () => {
    const runtime = await mountItem(tool('t1'));
    find(runtime.value, 'Pressable')[0].props.onPress?.();
    runtime.flush();
    const body = find(runtime.value, 'Text').find((node) => node.props.children === '$ git status --short\n M a.ts');
    expect(body?.props.selectable).toBe(false);
    expect(find(runtime.value, 'MarkdownText')).toHaveLength(0);
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
});
