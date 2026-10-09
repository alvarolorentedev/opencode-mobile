import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
const element = (type: unknown, props: Element['props']) => ({ type, props });
const flatten = (style: any): Record<string, any> => Array.isArray(style)
  ? Object.assign({}, ...style.map(flatten)) : style || {};
const platform = { OS: 'ios' };
const typography = { fontFamily: 'System', fontSize: 16, lineHeight: 24, letterSpacing: 0.5, fontWeight: '400' };
const native = {
  Platform: platform, StyleSheet: { create: (styles: unknown) => styles, flatten, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } },
  Keyboard: { dismiss: vi.fn() }, Text: 'NativeText', View: 'View',
  KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
  useWindowDimensions: () => ({ fontScale: 1, height: 844 }),
};
const paper = {
  TextInput: 'PaperTextInput', Chip: 'Chip', IconButton: 'IconButton', Surface: 'Surface', Text: 'Text',
  useTheme: () => ({ colors: { primary: '#00f' }, fonts: { bodyLarge: typography } }),
};
const jsx = { jsx: element, jsxs: element };

function find(root: Element, testID: string): Element | undefined {
  if (root?.props?.testID === testID) return root;
  const children = [root?.props?.children].flat(Infinity);
  for (const child of children) {
    if (child && typeof child === 'object') {
      const match = find(child, testID);
      if (match) return match;
    }
  }
}

const { styles } = await loadTs('components/chat/chat-view-styles.ts', {
  'react-native': native, '@/constants/theme': { Fonts: { sans: 'Avenir Next', display: 'Avenir Next' } },
});
const { TextInput } = await loadTs('components/ui/text-input.tsx', {
  'react/jsx-runtime': jsx, 'react-native': native, 'react-native-paper': paper,
});
const { OverlaySheet } = await loadTs('components/ui/overlay-sheet.tsx', {
  'react/jsx-runtime': jsx, 'react-native': native,
  'react-native-paper': { ...paper, Portal: 'Portal', Icon: 'Icon' },
  'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) },
  '@/constants/theme': { Colors: { dark: {} } },
  '@/hooks/use-update-blocker': { useUpdateBlocker: () => {} },
  '@/hooks/use-color-scheme': { useColorScheme: () => 'dark' },
  '@/hooks/use-dismiss-on-back': { useDismissOnBack: () => {} },
});

describe('keyboard sheet layout', () => {
  it.each([true, false])('constrains the scroll area inside a stable avoidance frame (fitContent=%s)', (fitContent) => {
    const root = OverlaySheet({ visible: true, title: 'Voice', testID: 'voice', fitContent, children: 'Content' });
    const frame = root.props.children;
    expect(frame.type).toBe('KeyboardAvoidingView');
    expect(frame.props.behavior).toBe('padding');
    expect(flatten(frame.props.style)).toMatchObject({ top: 0, bottom: 0, paddingTop: 126 });
    const sheet = frame.props.children[1];
    expect(sheet.type).toBe('View');
    expect(flatten(sheet.props.style)).toMatchObject({ flexShrink: 1 });
    expect(flatten(sheet.props.style).position).toBeUndefined();
    expect(flatten(sheet.props.style).flex).toBe(fitContent ? undefined : 1);
  });
});

describe('native input regressions', () => {
  let runtime: ReturnType<typeof hookRuntime>;
  let input: () => Element;
  let measurement: () => Element | undefined;

  beforeEach(async () => {
    platform.OS = 'ios';
    runtime = hookRuntime();
    const { ChatComposer } = await loadTs('components/chat/chat-composer.tsx', {
      react: runtime.react, 'react/jsx-runtime': jsx, 'react-native': native, 'react-native-paper': paper,
      'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
      '@/components/ui/text-input': { TextInput },
      '@/components/ui/native-select': { NativeSelect: 'NativeSelect' },
      '@/components/chat/model-picker': { ModelPicker: 'ModelPicker' },
      '@/components/chat/attachment-strip': { AttachmentStrip: 'AttachmentStrip' },
      '@/components/chat/chat-view-styles': { styles, slimStyles: {} },
      '@/components/chat/chat-view-utils': { getAutoApproveIcon: () => 'shield', REASONING_OPTIONS: [] },
    });
    runtime.mount(ChatComposer, {
      draft: 'hello', attachments: [], availableAgents: [], visibleModels: [], commands: [],
      chatPreferences: {}, conversation: {}, palette: {}, showSendAction: true,
    });
    input = () => find(runtime.value, 'chat-prompt-input')!;
    measurement = () => find(runtime.value, 'chat-prompt-measurement');
  });

  it.each([[false, 44, 110], [true, 36, 90]])('sizes iOS independently of input callbacks (slim=%s)', (slim, min, max) => {
    runtime.update({ slim });
    const resize = (height: number) => {
      measurement()!.props.onLayout({ nativeEvent: { layout: { height } } });
      runtime.flush();
    };
    expect(input().props.onContentSizeChange).toBeUndefined();
    resize(65.2);
    expect(flatten(input().props.style).height).toBe(66);
    expect(input().props.scrollEnabled).toBe(false);
    resize(400);
    expect(flatten(input().props.style).height).toBe(max);
    expect(input().props.scrollEnabled).toBe(true);
    resize(20);
    expect(flatten(input().props.style).height).toBe(min);
    expect(input().props.scrollEnabled).toBe(false);
    resize(400);
    runtime.update({ draft: '' });
    expect(flatten(input().props.style).height).toBe(min);
    expect(input().props.scrollEnabled).toBe(false);
  });

  it('measures trailing blank lines without changing the draft or exposing duplicate text', () => {
    const draft = 'wrapped words\n\n';
    const onDraftChange = vi.fn();
    runtime.update({ draft, onDraftChange });
    expect(measurement()!.props.children).toBe(`${draft}\u200b`);
    expect(input().props.value).toBe(draft);
    expect(input().props.onChangeText).toBe(onDraftChange);
    expect(measurement()!.props.accessible).toBe(false);
    expect(measurement()!.props.accessibilityElementsHidden).toBe(true);
    expect(measurement()!.props.pointerEvents).toBe('none');
    expect(measurement()!.props.maxFontSizeMultiplier).toBe(1.5);
    expect(flatten(measurement()!.props.style)).toMatchObject({ fontFamily: 'Avenir Next', fontSize: 17, letterSpacing: 0.5 });
    runtime.update({ slim: true });
    expect(flatten(measurement()!.props.style).fontSize).toBe(15);
  });

  it.each(['android', 'web'])('retains content-size growth and scrolling on %s', (os) => {
    platform.OS = os;
    runtime.flush();
    expect(measurement()).toBeUndefined();
    input().props.onContentSizeChange({ nativeEvent: { contentSize: { height: 80 } } });
    runtime.flush();
    expect(flatten(input().props.style).height).toBe(80);
    input().props.onContentSizeChange({ nativeEvent: { contentSize: { height: 200 } } });
    runtime.flush();
    expect(flatten(input().props.style).height).toBe(110);
    expect(input().props.scrollEnabled).toBe(true);
  });

  it('clears only the implicit single-line iOS alignment and preserves credentials', () => {
    const value = 'a long server password with spaces '.repeat(5);
    const onChangeText = vi.fn();
    const rendered = TextInput({ secureTextEntry: true, value, onChangeText });
    expect(flatten(rendered.props.contentStyle)).toHaveProperty('textAlign', undefined);
    expect(rendered.props.secureTextEntry).toBe(true);
    expect(rendered.props.value).toBe(value);
    expect(rendered.props.onChangeText).toBe(onChangeText);
    expect(rendered.props.selectionColor).toBe('#00f');
    expect(flatten(TextInput({ style: [{ textAlign: 'right' }] }).props.contentStyle)).not.toHaveProperty('textAlign');
    expect(flatten(TextInput({ contentStyle: [{ textAlign: 'center' }] }).props.contentStyle).textAlign).toBe('center');
  });

  it.each(['ios', 'android', 'web'])('preserves multiline and caller styling on %s', (os) => {
    platform.OS = os;
    const contentStyle = { fontSize: 20 };
    expect(TextInput({ multiline: true, contentStyle }).props.contentStyle).toBe(contentStyle);
    if (os !== 'ios') expect(TextInput({ contentStyle }).props.contentStyle).toBe(contentStyle);
  });
});
