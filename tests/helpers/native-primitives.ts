import { useRef } from 'react';
import { vi } from 'vitest';

const platform = vi.hoisted(() => ({
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  select: { open: false, onOpenChange: () => {}, triggerPosition: { width: 0 } },
  getAvailableVoicesAsync: vi.fn<typeof import("expo-speech").getAvailableVoicesAsync>(async () => []),
}));
export { platform as nativePrimitives };

// Metro resolves the native UI packages. The React probes inspect the app's
// composition without loading those packages or replacing app components.
vi.mock('@rn-primitives/slot', () => ({ Slot: 'Slot' }));
vi.mock('@rn-primitives/dialog', () => ({
  Root: 'DialogRoot', Portal: 'Portal', Content: 'DialogContent', Title: 'DialogTitle',
}));
vi.mock('@rn-primitives/portal', () => ({ Portal: 'Portal', PortalHost: 'PortalHost' }));
vi.mock('@rn-primitives/label', () => ({ Root: 'Label' }));
vi.mock('@rn-primitives/select', () => ({
  Root: 'SelectRoot', Group: 'SelectGroup', Content: 'SelectContent', Separator: 'Separator',
  Portal: 'Portal', Overlay: 'Overlay', useRootContext: () => platform.select,
}));
vi.mock('@rn-primitives/switch', () => ({ Root: 'Switch' }));
vi.mock('@react-native-community/slider', () => ({ default: 'Slider' }));
vi.mock('react-native-screens', () => ({ FullWindowOverlay: 'FullWindowOverlay' }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => platform.insets,
}));
vi.mock('react-native-gesture-handler', () => ({
  Gesture: { Pan: () => ({
    enabled() { return this; }, activeOffsetY() { return this; },
    onUpdate() { return this; }, onEnd() { return this; },
  }) },
  GestureDetector: 'GestureDetector',
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
  FadeIn: { reduceMotion: () => undefined },
  FadeOut: { reduceMotion: () => undefined },
  ReduceMotion: { System: 'system' },
  runOnJS: (callback: unknown) => callback,
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: unknown) => useRef({ value }).current,
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));
vi.mock('uniwind', () => ({ Uniwind: { setTheme() {}, updateCSSVariables() {} }, withUniwind: (component: unknown) => component }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({
  default: Object.assign(() => null, { glyphMap: {} }),
}));
vi.mock('@rn-primitives/toast', () => ({}));
vi.mock('@rn-primitives/toggle', () => ({ Root: 'ToggleRoot' }));
vi.mock('@rn-primitives/toggle-group', () => ({ Root: 'ToggleGroupRoot', Item: 'ToggleGroupItem' }));
vi.mock('@rn-primitives/alert-dialog', () => ({ Root: 'AlertDialogRoot', Trigger: 'AlertDialogTrigger', Portal: 'AlertDialogPortal' }));
vi.mock('@rn-primitives/separator', () => ({ Root: 'SeparatorRoot' }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('expo-video', () => ({ VideoView: 'VideoView', useVideoPlayer: () => undefined }));
vi.mock('expo-audio', () => ({}));
vi.mock('expo-linking', () => ({}));
vi.mock('expo-speech', () => ({ stop: async () => {}, getAvailableVoicesAsync: platform.getAvailableVoicesAsync }));
vi.mock('expo-haptics', () => ({}));
vi.mock('expo-clipboard', () => ({}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));
vi.mock('expo-sharing', () => ({}));
vi.mock('expo-application', () => ({}));
vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('@rn-primitives/progress', () => ({ Root: 'ProgressRoot', Indicator: 'ProgressIndicator' }));
vi.mock('@shopify/flash-list', async () => ({
  FlashList: 'FlashList',
  useRecyclingState: (await import('../../node_modules/@shopify/flash-list/dist/recyclerview/hooks/useRecyclingState')).useRecyclingState,
}));
vi.mock('@rn-primitives/collapsible', () => ({ Root: 'CollapsibleRoot', Trigger: 'CollapsibleTrigger', Content: 'CollapsibleContent' }));
vi.mock('@rn-primitives/radio-group', () => ({ Root: 'RadioGroupRoot' }));
vi.mock('@rn-primitives/checkbox', () => ({ Root: 'CheckboxRoot' }));
vi.mock('@rn-primitives/tabs', () => ({ Root: 'TabsRoot', List: 'TabsList', Trigger: 'TabsTrigger', Content: 'TabsContent' }));
vi.mock('expo-web-browser', () => ({}));
vi.mock('expo-auth-session', () => ({}));
