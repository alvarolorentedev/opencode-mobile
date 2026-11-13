import { uiImports, textContent } from '../../../tests/helpers/ui.mjs';
import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';
import type { SubagentDetail } from '@/shared/presentation/transcript';

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown; onPress?: () => void } };

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

function translate(key: string) {
  if (key === 'chat:tools.subagent') return 'Subagent';
  if (key === 'chat:subagent.open') return 'Open subagent chat';
  if (key === 'chat:subagent.running') return 'Working';
  if (key === 'chat:subagent.completed') return 'Completed';
  if (key === 'chat:subagent.failed') return 'Failed';
  if (key === 'chat:subagent.cancelled') return 'Cancelled';
  return key;
}

const palette = { tint: '#0af', danger: '#f00', muted: '#888', surface: '#111', surfaceAlt: '#222', border: '#333' };

const detail = (overrides: Partial<SubagentDetail> = {}): SubagentDetail => ({
  id: 's1',
  kind: 'subagent',
  sessionID: 'ses_child',
  agent: 'explore',
  description: 'Audit chat rendering',
  status: 'running',
  ...overrides,
});

async function mount(detailValue: SubagentDetail, onPress = vi.fn()) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { SubagentRow } = await loadTs('features/chat/ui/cards/subagent-row.tsx', {
    ...uiImports,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    'react-native': { Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value }, View: 'View' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@/shared/ui/theme/theme': { Colors: { light: {} } },
  }, runtime.globals);
  runtime.mount(SubagentRow, { detail: detailValue, onPress, palette });
  return { runtime, onPress };
}

describe('subagent row', () => {
  it('renders a running chip and opens the child chat', async () => {
    const { runtime, onPress } = await mount(detail());
    const button = find(runtime.value, 'Pressable')[0];
    expect(find(runtime.value, 'ActivityIndicator')).toHaveLength(1);
    expect(button.props.accessibilityState).toEqual({ busy: true });
    expect(button.props.accessibilityLabel).toBe('Audit chat rendering, explore. Working. Open subagent chat');
    expect(textContent(button)).toContain('Audit chat rendering');
    expect(textContent(button)).toContain('explore');
    button.props.onPress?.();
    expect(onPress).toHaveBeenCalledWith('ses_child');
  });

  it('replaces the spinner with the settled status icon', async () => {
    const { runtime } = await mount(detail({ status: 'completed' }));
    expect(find(runtime.value, 'ActivityIndicator')).toHaveLength(0);
    expect(find(runtime.value, 'Icon').map((node) => node.props.name)).toContain('check-circle-outline');
    expect(find(runtime.value, 'Icon').map((node) => node.props.name)).toContain('chevron-right');
  });

  it('uses the localized subagent label when the notice has no description', async () => {
    const { runtime } = await mount(detail({ description: undefined, agent: undefined }));
    expect(textContent(runtime.value)).toContain('Subagent');
  });
});
