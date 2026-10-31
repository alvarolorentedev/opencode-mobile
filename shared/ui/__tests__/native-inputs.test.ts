import { uiImports } from '../../../tests/helpers/ui.mjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';
import { Spacing } from '../theme/design-tokens';

type Element = { type: unknown; props: Record<string, any> };
const element = (type: unknown, props: Element['props']) => ({ type, props });
const flatten = (style: any): Record<string, any> => Array.isArray(style)
  ? Object.assign({}, ...style.map(flatten)) : style || {};
const platform = { OS: 'ios', select: (choices: Record<string, unknown>) => choices[platform.OS] ?? choices.native ?? choices.default };
const native = {
  Platform: platform, StyleSheet: { create: (styles: unknown) => styles, flatten, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } },
  Keyboard: { dismiss: vi.fn() }, Text: 'NativeText', TextInput: 'NativeTextInput', View: 'View',
  KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
  useWindowDimensions: () => ({ fontScale: 1, height: 844 }),
};
const jsx = { jsx: element, jsxs: element };
const dismissKeyboardCalls: unknown[][] = [];

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

const viewStyles = await loadTs('features/chat/ui/chat-view-styles.ts', {
    ...uiImports,
    'react-native': native,
    "@/shared/ui/theme/theme": { Fonts: { sans: 'Avenir Next', display: 'Avenir Next' } }
  });
const { Input } = await loadTs('shared/ui/input.tsx', {
    ...uiImports,
    'react/jsx-runtime': jsx,
    'react-native': native,
    "@/shared/ui/theme/use-palette": { usePalette: () => ({ tint: '#00f' }) }
  });
const selectDimensions = { width: 390, height: 844 };
const selectTrigger = { width: 360 };
const { SelectContent } = await loadTs('shared/ui/select.tsx', {
    ...uiImports,
    react: { useContext: () => undefined },
    'react/jsx-runtime': jsx,
    'react-native': { ...native, useWindowDimensions: () => selectDimensions },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) },
    'react-native-screens': { FullWindowOverlay: 'FullWindowOverlay' },
    'react-native-reanimated': { FadeIn: { reduceMotion: () => ({}) }, FadeOut: { reduceMotion: () => ({}) }, ReduceMotion: { System: 'system' } },
    '@rn-primitives/select': {
    Portal: 'Portal', Overlay: 'Overlay', useRootContext: () => ({ open: true, onOpenChange: () => {}, triggerPosition: selectTrigger }),
  },
    "@/shared/ui/theme/design-tokens": { Spacing },
    "@/shared/ui/text": { Text: 'Text', TextClassContext: { Provider: 'TextProvider' } },
    "@/shared/ui/native-only-animated-view": { NativeOnlyAnimatedView: 'AnimatedView' },
    "./select-frame": { SelectFrame: 'SelectContent' },
    "@/runtime/workspace/workspace-context": { WorkspaceScopeContext: {} }
  });
const { OverlaySheet } = await loadTs('shared/ui/overlay-sheet.tsx', {
    ...uiImports,
    './portal': uiImports['@/shared/ui/portal'],
    '@rn-primitives/dialog': { Root: 'Dialog', Portal: 'Portal', Content: 'DialogContent', Title: 'DialogTitle' },
    react: {
    useContext: () => undefined,
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
    useEffect: () => {},
  },
    'react/jsx-runtime': jsx,
    'react-native': native,
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
    "@/shared/ui/dialog-frame.web": { DialogFrame: 'DialogContent' },
    "@/runtime/workspace/workspace-context": { WorkspaceScope: 'WorkspaceScope', WorkspaceScopeContext: {} },
    "@/shared/ui/theme/theme": { Colors: { dark: {} } },
    "@/runtime/presentation/use-update-blocker": { useUpdateBlocker: () => {} },
    "@/shared/ui/hooks/use-dismiss-keyboard-on-open": { useDismissKeyboardOnOpen: (...args: unknown[]) => { dismissKeyboardCalls.push(args); } },
    "@/shared/ui/theme/use-palette": { usePalette: () => ({}) },
    "@/shared/ui/theme/use-color-scheme": { useColorScheme: () => 'dark' },
    "@/shared/ui/hooks/use-dismiss-on-back": { useDismissOnBack: () => {} },
    "@/shared/ui/use-swipe-dismiss": { useSwipeDismiss: () => ({ pan: {}, sheetStyle: {}, backdropStyle: {}, handleSheetLayout: () => {} }) }
  });

describe('keyboard sheet layout', () => {
  beforeEach(() => {
    dismissKeyboardCalls.length = 0;
  });

  it.each([true, false])('constrains the scroll area inside a stable avoidance frame (fitContent=%s)', (fitContent) => {
    const root = OverlaySheet({ visible: true, title: 'Voice', testID: 'voice', fitContent, children: 'Content' });
    const frame = find(root, 'voice')!;
    expect(frame.type).toBe('KeyboardAvoidingView');
    expect(frame.props.behavior).toBe('padding');
    expect(frame.props.className).toContain('inset-0');
    expect(flatten(frame.props.style)).toMatchObject({ paddingTop: 126 });
    const sheet = frame.props.children[1].props.children;
    expect(sheet.type).toBe('View');
    expect(flatten(sheet.props.style)).toMatchObject({ flexShrink: 1 });
    expect(flatten(sheet.props.style).position).toBeUndefined();
    expect(flatten(sheet.props.style).flex).toBe(fitContent ? undefined : 1);
  });

  it('dismisses the keyboard on open unless the sheet opts out', () => {
    OverlaySheet({ visible: true, title: 'Voice', onClose: () => {}, children: 'Content' });
    expect(dismissKeyboardCalls[dismissKeyboardCalls.length - 1]).toEqual([true, true]);
    OverlaySheet({ visible: true, title: 'Rename', onClose: () => {}, dismissKeyboard: false, children: 'Content' });
    expect(dismissKeyboardCalls[dismissKeyboardCalls.length - 1]).toEqual([true, false]);
  });
});

describe('native select layout', () => {
  it.each([360, 600])('keeps long options scrollable within the screen (trigger width %s)', (width) => {
    platform.OS = 'android';
    selectTrigger.width = width;
    const content = find(SelectContent({ testID: 'native-select', children: 'Long translated options' }), 'native-select')!;
    expect(content.props.style.width).toBe(Math.min(width, 374));
    const viewport = content.props.children[1];
    expect(viewport.type).toBe('ScrollView');
    expect(viewport.props.style.maxHeight).toBeLessThan(844 - 62 - 34);
    expect(viewport.props.keyboardShouldPersistTaps).toBe('handled');
  });
});

describe('native input regressions', () => {
  let runtime: ReturnType<typeof hookRuntime>;
  let input: () => Element;

  beforeEach(async () => {
    platform.OS = 'ios';
    runtime = hookRuntime();
    const { ChatComposer } = await loadTs('features/chat/ui/chat-composer.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': jsx,
    'react-native': native,
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    '@/features/chat/ui/chat-view-styles': viewStyles,
    "@/shared/ui/input": { Input },
    "@/shared/ui/catalog-select": { CatalogSelect: 'CatalogSelect' },
    "@/features/ai/ui/model-picker": { ModelPicker: 'ModelPicker' },
    "@/features/chat/ui/composer-suggestions": { ComposerSuggestions: 'ComposerSuggestions' },
    "@/features/sharing/ui/attachment-strip": { AttachmentStrip: 'AttachmentStrip' },
    "@/features/chat/ui/chat-view-utils": { getAutoApproveIcon: () => 'shield' },
    "@/shared/ui/theme/color": { withAlpha: (color: string) => color }
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

  it('preserves credential bytes and explicit single-line alignment', () => {
    const value = 'a long server password with spaces '.repeat(5);
    const onChangeText = vi.fn();
    const rendered = Input({ secureTextEntry: true, value, onChangeText });
    expect(rendered.props.secureTextEntry).toBe(true);
    expect(rendered.props.value).toBe(value);
    expect(rendered.props.onChangeText).toBe(onChangeText);
    expect(rendered.props.selectionColor).toBe('#00f');
    expect(flatten(Input({ style: { textAlign: 'right' } }).props.style).textAlign).toBe('right');
    expect(flatten(rendered.props.style)).not.toHaveProperty('textAlign');
  });

  it.each(['ios', 'android', 'web'])('preserves multiline and caller styling on %s', (os) => {
    platform.OS = os;
    const style = { fontSize: 20 };
    expect(Input({ multiline: true, style }).props.style).toBe(style);
    expect(Input({ cursorColor: '#f00' }).props.cursorColor).toBe('#f00');
  });
});
