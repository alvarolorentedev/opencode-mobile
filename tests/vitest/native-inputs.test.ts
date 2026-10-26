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
  '@/providers/workspace-context': { WorkspaceScope: 'WorkspaceScope', WorkspaceScopeContext: {} },
  react: {
    useContext: () => undefined,
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
    useEffect: () => {},
  },
  'react/jsx-runtime': jsx, 'react-native': native,
  'react-native-paper': { ...paper, Portal: 'Portal', Icon: 'Icon' },
  'react-native-gesture-handler': {
    Gesture: { Pan: () => ({ enabled() { return this; }, activeOffsetY() { return this; }, onUpdate() { return this; }, onEnd() { return this; } }) },
    GestureDetector: 'GestureDetector',
  },
  'react-native-reanimated': {
    __esModule: true,
    default: { View: 'View' },
    runOnJS: (fn: () => void) => fn,
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => ({ value }),
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
  },
  'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) },
  '@/constants/theme': { Colors: { dark: {} } },
  '@/hooks/use-update-blocker': { useUpdateBlocker: () => {} },
  '@/hooks/use-palette': { usePalette: () => ({}) },
  '@/hooks/use-color-scheme': { useColorScheme: () => 'dark' },
  '@/hooks/use-dismiss-on-back': { useDismissOnBack: () => {} },
  './use-swipe-dismiss': { useSwipeDismiss: () => ({ pan: {}, sheetStyle: {}, backdropStyle: {}, handleSheetLayout: () => {} }) },
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

  beforeEach(async () => {
    platform.OS = 'ios';
    runtime = hookRuntime();
    const { ChatComposer } = await loadTs('components/chat/chat-composer.tsx', {
      react: runtime.react, 'react/jsx-runtime': jsx, 'react-native': native, 'react-native-paper': paper,
      'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
      '@/components/ui/text-input': { TextInput },
      '@/components/ui/native-select': { NativeSelect: 'NativeSelect' },
      '@/components/chat/model-picker': { ModelPicker: 'ModelPicker' },
      '@/components/chat/composer-suggestions': { ComposerSuggestions: 'ComposerSuggestions' },
      '@/components/chat/attachment-strip': { AttachmentStrip: 'AttachmentStrip' },
      '@/components/chat/chat-view-styles': { styles, slimStyles: {} },
      '@/components/chat/chat-view-utils': { getAutoApproveIcon: () => 'shield' },
      '@/lib/color': { withAlpha: (color: string) => color },
    });
    runtime.mount(ChatComposer, {
      draft: 'hello', attachments: [], availableAgents: [], visibleModels: [], commands: [],
      chatPreferences: {}, conversation: {}, palette: {}, showSendAction: true,
    });
    input = () => find(runtime.value, 'chat-prompt-input')!;
  });

  it.each([[false, 44, 110], [true, 40, 90]])('lets iOS grow the native input between its caps (slim=%s)', (slim, min, max) => {
    runtime.update({ slim });
    expect(find(runtime.value, 'chat-prompt-measurement')).toBeUndefined();
    expect(input().props.onContentSizeChange).toBeUndefined();
    expect(input().props.scrollEnabled).toBe(true);
    const style = flatten(input().props.style);
    expect(style.height).toBeUndefined();
    expect(style).toMatchObject({ minHeight: min, maxHeight: max, fontSize: slim ? 15 : 17 });
    expect(flatten(input().props.contentStyle)).toMatchObject({ minHeight: min, maxHeight: max });
    expect(input().props.value).toBe('hello');
  });

  it.each(['android', 'web'])('retains content-size growth and scrolling on %s', (os) => {
    platform.OS = os;
    runtime.flush();
    expect(flatten(input().props.style).minHeight).toBeUndefined();
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
