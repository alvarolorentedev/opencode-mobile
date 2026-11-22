// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { describe, expect, it, vi } from 'vitest';

import { SubagentRow } from '@/features/chat/ui/cards/subagent-row';
import type { SubagentDetail } from '@/shared/presentation/transcript';
import { Icon } from '@/shared/ui/icon';
import { Spinner } from '@/shared/ui/spinner';
import { Colors } from '@/shared/ui/theme/theme';
import { textContent } from '../../../tests/helpers/text-content';

import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'android' }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown; onPress?: () => void } };

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

function translate(key: string) {
  if (key === 'chat:tools.subagent') return 'Subagent';
  if (key === 'chat:subagent.open') return 'Open subagent chat';
  if (key === 'chat:subagent.running') return 'Working';
  if (key === 'chat:subagent.completed') return 'Completed';
  if (key === 'chat:subagent.failed') return 'Failed';
  if (key === 'chat:subagent.cancelled') return 'Cancelled';
  return key;
}

const palette = { ...Colors.light, tint: '#0af', danger: '#f00', muted: '#888', surface: '#111', surfaceAlt: '#222', border: '#333' };

const detail = (overrides: Partial<SubagentDetail> = {}): SubagentDetail => ({
  id: 's1',
  kind: 'subagent',
  sessionID: 'ses_child',
  agent: 'explore',
  description: 'Audit chat rendering',
  status: 'running',
  ...overrides,
});

function mount(detailValue: SubagentDetail, onPress = vi.fn()) {
  const runtime = renderHook(SubagentRow, { detail: detailValue, onPress, palette });
  return { runtime, onPress };
}

describe('subagent row', () => {
  it('renders a running chip and opens the child chat', async () => {
    const { runtime, onPress } = mount(detail());
    const button = find(runtime.result.current, 'Pressable')[0];
    expect(find(runtime.result.current, Spinner)).toHaveLength(1);
    expect(button.props.accessibilityState).toEqual({ busy: true });
    expect(button.props.accessibilityLabel).toBe('Audit chat rendering, explore. Working. Open subagent chat');
    expect(textContent(button)).toContain('Audit chat rendering');
    expect(textContent(button)).toContain('explore');
    button.props.onPress?.();
    expect(onPress).toHaveBeenCalledWith('ses_child');
  });

  it('replaces the spinner with the settled status icon', async () => {
    const { runtime } = mount(detail({ status: 'completed' }));
    expect(find(runtime.result.current, Spinner)).toHaveLength(0);
    expect(find(runtime.result.current, Icon).concat(find(runtime.result.current, MaterialCommunityIcons)).map((node) => node.props.name)).toContain('check-circle-outline');
    expect(find(runtime.result.current, Icon).concat(find(runtime.result.current, MaterialCommunityIcons)).map((node) => node.props.name)).toContain('chevron-right');
  });

  it('uses the localized subagent label when the notice has no description', async () => {
    const { runtime } = mount(detail({ description: undefined, agent: undefined }));
    expect(textContent(runtime.result.current)).toContain('Subagent');
  });
});
