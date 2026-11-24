// @vitest-environment happy-dom

import { chatComposerProbe } from '../../../tests/helpers/chat-composer-probe';
import { act, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Content as DialogFrame } from '@rn-primitives/dialog';
import { ChatPromptInput } from '@/features/chat/ui/chat-prompt-input';
import { Input } from '@/shared/ui/input';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { SelectContent } from '@/shared/ui/select';
import { AppearanceProvider } from '@/shared/ui/theme/appearance-context';
import { DEFAULT_ACCENT_COLOR } from '@/shared/ui/theme/appearance';
import { Colors } from '@/shared/ui/theme/theme';
import { nativePrimitives } from '../../../tests/helpers/native-primitives';
import { renderHook } from '../../../tests/helpers/render-hook';

// The probe inspects native input props without mounting the codegen view.
const device = vi.hoisted(() => ({ platform: 'web', dismiss: vi.fn() }));
vi.mock('react-native', async () => {
  const native = (await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform(device);
  return { ...native, Keyboard: { ...native.Keyboard, dismiss: device.dismiss } };
});
nativePrimitives.insets = { top: 62, bottom: 34, left: 0, right: 0 };
nativePrimitives.select.open = true;

type Element = { type: unknown; props: Record<string, any> };
const flatten = (style: any): Record<string, any> => Array.isArray(style)
  ? Object.assign({}, ...style.map(flatten)) : style || {};

function find(root: Element | null, testID: string): Element | undefined {
  if (root?.props?.testID === testID) return root;
  const children = [root?.props?.children].flat(Infinity);
  for (const child of children) {
    if (child && typeof child === 'object') {
      const match = find(child, testID);
      if (match) return match;
    }
  }
}

function findByType(root: Element, type: unknown): Element | undefined {
  if (root?.type === type) return root;
  const children = [root?.props?.children].flat(Infinity);
  for (const child of children) {
    if (child && typeof child === 'object') {
      const match = findByType(child, type);
      if (match) return match;
    }
  }
}

const sheet = (props: Parameters<typeof OverlaySheet>[0]) => renderHook(OverlaySheet, props).result.current;
const select = (props: Parameters<typeof SelectContent>[0]) => renderHook(SelectContent, props).result.current;
const field = (props: Parameters<typeof Input>[0]) => renderHook(Input, props, ({ children }) =>
  createElement(AppearanceProvider, { value: { scheme: 'light', accent: DEFAULT_ACCENT_COLOR, palette: { ...Colors.light, tint: '#00f' } } }, children)).result.current;

describe('keyboard sheet layout', () => {
  beforeEach(() => {
    device.platform = 'ios';
    device.dismiss.mockClear();
  });

  it.each([true, false])('constrains the scroll area inside a stable avoidance frame (fitContent=%s)', (fitContent) => {
    const root = sheet({ visible: true, title: 'Voice', testID: 'voice', onClose: vi.fn(), fitContent, children: 'Content' });
    const frame = find(root, 'voice')!;
    expect(frame.type).toBe('KeyboardAvoidingView');
    expect(frame.props.behavior).toBe('padding');
    expect(frame.props.className).toContain('inset-0');
    expect(flatten(frame.props.style)).toMatchObject({ paddingTop: 126 });
    const panel = frame.props.children[1].props.children;
    expect(panel.type).toBe('AnimatedView');
    expect(flatten(panel.props.style)).toMatchObject({ flexShrink: 1 });
    expect(flatten(panel.props.style).position).toBeUndefined();
    expect(flatten(panel.props.style).flex).toBe(fitContent ? undefined : 1);
  });

  it('does not claim touch starts from the sheet body', () => {
    const root = sheet({ visible: true, title: 'Files', testID: 'files', onClose: () => {}, children: 'Content' });
    const content = findByType(root!, DialogFrame)!;
    expect(content.props.onStartShouldSetResponder?.()).toBe(false);
  });

  it('keeps the safe-area insets when a compact sheet expands', () => {
    const props = {
      visible: true, title: 'Files changed', testID: 'files', compact: true, scrollable: false, onClose: () => {},
      onToggleExpanded: () => {}, children: 'Content',
    };
    const compact = find(sheet(props), 'files')!;
    const expanded = find(sheet({ ...props, expanded: true }), 'files')!;
    expect(flatten(compact.props.style).paddingTop).toBeCloseTo(844 * 0.45);
    expect(flatten(expanded.props.style).paddingTop).toBe(64 + 62);
    const body = find(expanded, 'files-sheet')!.props.children[1];
    expect(flatten(body.props.style).paddingBottom).toBe(34);
  });

  it('dismisses the keyboard on open unless the sheet opts out', () => {
    sheet({ visible: true, title: 'Voice', onClose: () => {}, children: 'Content' });
    expect(device.dismiss).toHaveBeenCalledOnce();
    sheet({ visible: true, title: 'Rename', onClose: () => {}, dismissKeyboard: false, children: 'Content' });
    expect(device.dismiss).toHaveBeenCalledOnce();
  });
});

describe('native select layout', () => {
  it.each([360, 600])('keeps long options scrollable within the screen (trigger width %s)', (width) => {
    device.platform = 'android';
    nativePrimitives.select.triggerPosition.width = width;
    const content = find(select({ testID: 'native-select', children: 'Long translated options' }), 'native-select')!;
    expect(content.props.style.width).toBe(Math.min(width, 374));
    const viewport = content.props.children[1];
    expect(viewport.type).toBe('ScrollView');
    expect(viewport.props.style.maxHeight).toBeLessThan(844 - 62 - 34);
    expect(viewport.props.keyboardShouldPersistTaps).toBe('handled');
  });
});

describe('native input regressions', () => {
  let runtime: ReturnType<typeof chatComposerProbe>;
  let input: () => Element;

  beforeEach(() => {
    device.platform = 'ios';
    runtime = chatComposerProbe({ draft: 'hello' });
    input = () => findByType(runtime.result.current, ChatPromptInput)!;
  });

  it('lets iOS grow the native input between the compact caps', () => {
    expect(find(runtime.result.current, 'chat-prompt-measurement')).toBeUndefined();
    expect(input().props.onContentSizeChange).toBeUndefined();
    expect(input().props.scrollEnabled).toBe(true);
    const style = flatten(input().props.style);
    expect(style.height).toBeUndefined();
    expect(style).toMatchObject({ minHeight: 40, maxHeight: 90, fontSize: 15 });
    expect(input().props.value).toBe('hello');
  });

  it.each(['android', 'web'])('retains content-size growth and scrolling on %s', (os) => {
    device.platform = os;
    runtime.update();
    expect(flatten(input().props.style).minHeight).toBeUndefined();
    act(() => input().props.onContentSizeChange(80));
    expect(flatten(input().props.style).height).toBe(80);
    act(() => input().props.onContentSizeChange(200));
    expect(flatten(input().props.style).height).toBe(90);
    expect(input().props.scrollEnabled).toBe(true);
  });

  it('lets the composer keep both horizontal margins', () => {
    expect(flatten(input().props.style).marginHorizontal).toBe(8);
  });

  it('preserves credential bytes and explicit single-line alignment', () => {
    const value = 'a long server password with spaces '.repeat(5);
    const onChangeText = vi.fn();
    const rendered = field({ secureTextEntry: true, value, onChangeText });
    expect(rendered.props.secureTextEntry).toBe(true);
    expect(rendered.props.value).toBe(value);
    expect(rendered.props.onChangeText).toBe(onChangeText);
    expect(rendered.props.selectionColor).toBe('#00f');
    expect(flatten(field({ style: { textAlign: 'right' } }).props.style).textAlign).toBe('right');
    expect(flatten(rendered.props.style)).not.toHaveProperty('textAlign');
  });

  it.each(['ios', 'android', 'web'])('preserves multiline and caller styling on %s', (os) => {
    device.platform = os;
    const style = { fontSize: 20 };
    expect(field({ multiline: true, style }).props.style).toBe(style);
    expect(field({ cursorColor: '#f00' }).props.cursorColor).toBe('#f00');
  });
});
