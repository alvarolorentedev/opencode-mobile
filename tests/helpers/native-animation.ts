import { useRef } from 'react';
import { vi } from 'vitest';

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
