// @vitest-environment happy-dom

import '../../../tests/helpers/native-primitives';
import { describe, expect, it, vi } from 'vitest';

import { PendingPrompts } from '@/features/chat/ui/pending-prompts';

import { renderHook } from '../../../tests/helpers/render-hook';

vi.mock('react-native', async () => (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'android' }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('expo-router', () => ({ usePathname: () => '/' }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

type Element = { type: unknown; props: Record<string, any> };

function findElement(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as Element;
  if (element.props && predicate(element)) return element;
  return findElement(element.props?.children, predicate);
}

const prompt = (id: string, state: 'sending' | 'waiting') => ({
  id,
  sessionId: 'session-1',
  text: `prompt ${id}`,
  createdAt: 1,
  attachments: [],
  delivery: 'steer' as const,
  state,
});

function mountPendingPrompts(props: {
  cancelingId?: string;
  onCancel: Parameters<typeof PendingPrompts>[0]['onCancel'];
  prompts: ReturnType<typeof prompt>[];
}) {
  return renderHook(PendingPrompts, props).result.current;
}

describe('pending prompts', () => {
  it('offers an active cancel action only for waiting prompts', async () => {
    const waiting = prompt('m1', 'waiting');
    const sending = prompt('m2', 'sending');
    const onCancel = vi.fn();
    const tree = mountPendingPrompts({ prompts: [waiting, sending], onCancel });

    const waitingClose = findElement(tree, (element) => element.props.testID === 'pending-prompt-cancel-m1');
    expect(waitingClose?.props.disabled).toBe(false);
    waitingClose?.props.onPress();
    expect(onCancel).toHaveBeenCalledWith(waiting);

    const sendingClose = findElement(tree, (element) => element.props.testID === 'pending-prompt-cancel-m2');
    expect(sendingClose?.props.disabled).toBe(true);
  });

  it('replaces the close action with progress while cancellation is in flight', async () => {
    const tree = mountPendingPrompts({ cancelingId: 'm1', prompts: [prompt('m1', 'waiting')], onCancel: vi.fn() });
    expect(findElement(tree, (element) => element.props.testID === 'pending-prompt-cancel-m1')).toBeUndefined();
  });
});
