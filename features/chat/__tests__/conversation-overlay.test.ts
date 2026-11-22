// @vitest-environment happy-dom

import { nativePrimitives } from '../../../tests/helpers/native-view-hosts';
import { act, useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConversationOverlay } from '@/features/chat/ui/chat-overlay';
import { ConversationConfirmation } from '@/features/voice/ui/conversation-confirmation';
import { ConversationWave, waveAmplitude, wavePath } from '@/features/voice/ui/conversation-wave';
import { renderHook } from '../../../tests/helpers/render-hook';
import { textContent } from '../../../tests/helpers/text-content';

const native = vi.hoisted(() => ({
  reducedMotion: false, height: 844, fontScale: 1, shared: [] as { value: number }[],
  motionChanged: (_enabled: boolean) => {}, remove: vi.fn(), cancelAnimation: vi.fn(),
  withRepeat: vi.fn((value: number) => value), withTiming: vi.fn((value: number) => value),
}));
vi.mock('react-native', async () => ({
  ...(await import('../../../tests/helpers/native-view-platform')).nativeViewPlatform({ platform: 'ios' }),
  useWindowDimensions: () => ({ height: native.height, fontScale: native.fontScale, width: 390, scale: 1 }),
  AccessibilityInfo: { addEventListener: (_event: string, handler: typeof native.motionChanged) => {
    native.motionChanged = handler;
    return { remove: native.remove };
  } },
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', Defs: 'Defs', LinearGradient: 'Gradient', Path: 'Path', Stop: 'Stop' }));
vi.mock('react-native-reanimated', () => ({
  default: { createAnimatedComponent: () => 'AnimatedPath' },
  cancelAnimation: native.cancelAnimation, Easing: { linear: 'linear' },
  useReducedMotion: () => native.reducedMotion,
  useSharedValue: (initial: number) => useMemo(() => {
    const value = { value: initial };
    native.shared.push(value);
    return value;
  }, [initial]),
  useAnimatedProps: (getProps: () => unknown) => getProps(),
  withRepeat: native.withRepeat, withTiming: native.withTiming,
}));
vi.mock('expo-router', () => ({ useIsFocused: () => true, usePathname: () => '/' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('expo/fetch', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, args?: { phrase?: string }) => args?.phrase ? `${key}:${args.phrase}` : key, i18n: { language: 'en' } }),
}));
nativePrimitives.insets = { top: 44, bottom: 34, left: 0, right: 0 };

type Element = { type: unknown; props: Record<string, any> };

function mountWave(reducedMotion = false) {
  native.reducedMotion = reducedMotion;
  native.shared = [];
  vi.clearAllMocks();
  let props: Parameters<typeof ConversationWave>[0] = waveProps;
  const runtime = renderHook(ConversationWave, props);
  function update(patch: Partial<typeof props>) {
    props = { ...props, ...patch };
    runtime.rerender(props);
  }
  return { ...native, runtime, update, changeMotion: (enabled: boolean) => act(() => native.motionChanged(enabled)) };
}

const waveProps: Parameters<typeof ConversationWave>[0] = { phase: 'listening', level: 5, tint: '#7AE7C0', accent: '#58D4AB', height: 140 };

describe('conversation ribbon', () => {
  it('bounds microphone amplitude and ignores the microphone outside command capture', async () => {
    expect(waveAmplitude('listening', -2)).toBe(0.1);
    expect(waveAmplitude('listening', NaN)).toBe(0.1);
    expect(waveAmplitude('listening', Infinity)).toBe(0.1);
    expect(waveAmplitude('listening', 10)).toBe(1);
    expect(waveAmplitude('listening', 100)).toBe(1);
    expect(waveAmplitude('listening', 2)).toBeLessThan(waveAmplitude('listening', 8));
    for (const phase of ['off', 'armed', 'submitting', 'waiting', 'speaking'] as const) {
      expect(waveAmplitude(phase, 0)).toBe(waveAmplitude(phase, 10));
    }
    expect(waveAmplitude('off', 10)).toBe(0);
    expect(waveAmplitude('speaking', 0)).toBeGreaterThan(waveAmplitude('waiting', 0));
  });

  it('keeps all curves within the viewport, tapers the ends and loops without a jump', async () => {
    const points = (path: string) => path.trim().split(' ').map((point) => point.slice(1).split(',').map(Number));
    for (const offset of [0, 0.6, 1.2]) {
      for (const progress of [0, 1, Math.PI * 2, Math.PI * 4]) {
        const curve = points(wavePath(1, progress, offset));
        expect(curve).toHaveLength(65);
        expect(curve[0]).toEqual([0, 70]);
        expect(curve.at(-1)).toEqual([360, 70]);
        for (const [x, y] of curve) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(y).toBeGreaterThanOrEqual(20);
          expect(y).toBeLessThanOrEqual(120);
        }
      }
      const first = points(wavePath(1, 0, offset));
      const last = points(wavePath(1, Math.PI * 4, offset));
      first.forEach((point, index) => expect(point[1]).toBeCloseTo(last[index][1], 10));
    }
  });

  it('interpolates meter changes without restarting the travelling wave and cleans up on exit', async () => {
    const wave = mountWave();
    const root = wave.runtime.result.current;
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(wave.withRepeat).toHaveBeenCalledTimes(1);
    wave.update({ level: 9 });
    expect(wave.shared[1].value).toBeCloseTo(0.91);
    expect(wave.withRepeat).toHaveBeenCalledTimes(1);
    wave.update({ phase: 'off' });
    expect(wave.shared.map((value: { value: number }) => value.value)).toEqual([0, 0]);
    wave.cancelAnimation.mockClear();
    wave.runtime.unmount();
    expect(wave.cancelAnimation).toHaveBeenCalledWith(wave.shared[0]);
    expect(wave.cancelAnimation).toHaveBeenCalledWith(wave.shared[1]);
    expect(wave.remove).toHaveBeenCalledOnce();
  });

  it('renders a still ribbon with reduced motion, including changes while mounted', async () => {
    const wave = mountWave(true);
    expect(wave.withRepeat).not.toHaveBeenCalled();
    expect(wave.withTiming).not.toHaveBeenCalled();
    const stillAmplitude = wave.shared[1].value;
    wave.update({ level: 10, phase: 'speaking' });
    expect(wave.shared[1].value).toBe(stillAmplitude);
    wave.changeMotion(false);
    expect(wave.withRepeat).toHaveBeenCalledOnce();
    wave.changeMotion(true);
    expect(wave.shared[0].value).toBe(0);
    wave.update({ phase: 'off' });
    expect(wave.shared[1].value).toBe(0);
    wave.runtime.unmount();
  });
});

function descendants(root: any): Element[] {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(descendants);
  return [root, ...descendants(root.props?.children)];
}

function renderOverlay(patch: Partial<Parameters<typeof ConversationOverlay>[0]> = {}, dimensions = { height: 844, fontScale: 1 }) {
  Object.assign(native, dimensions);
  const onStop = vi.fn();
  const root = renderHook(ConversationOverlay, {
    connectionStatus: 'connected', inputPhase: 'listening', insetsTop: 44, latestUserText: 'Make the header simpler',
    level: 7, onStop, phase: 'listening', readbackPhase: 'idle', sessionTitle: 'Refine the home screen', wakePhrase: 'hey code', ...patch,
  }).result.current;
  return { root, nodes: descendants(root), onStop };
}

describe('conversation overlay', () => {
  it('passes the live meter, retains the heard command and invokes the existing stop action', async () => {
    const { root, nodes, onStop } = renderOverlay();
    expect(root.props.accessibilityViewIsModal).toBe(true);
    expect(nodes.find((node) => node.type === ConversationWave)?.props).toMatchObject({ phase: 'listening', level: 7 });
    expect(nodes.some((node) => node.props.children === 'Make the header simpler')).toBe(true);
    const end = nodes.find((node) => node.props.testID === 'conversation-end')!;
    expect(textContent(end)).toBe('chat:overlay.endConversation');
    end.props.onPress();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('hands an active confirmation to the dedicated card instead of the last-heard snippet', async () => {
    const confirmation = {
      active: true,
      phase: 'listening' as const,
      text: 'Refactor the login component',
      speaking: false,
      actions: { cancel: vi.fn(), confirm: vi.fn(), edit: vi.fn(), retry: vi.fn() },
    };
    const { nodes } = renderOverlay({ confirmation, inputPhase: 'confirming', phase: 'confirming' });
    expect(nodes.find((node) => node.type === ConversationConfirmation)?.props.confirmation).toBe(confirmation);
    expect(nodes.some((node) => node.props.children === 'chat:overlay.phaseConfirming:hey code')).toBe(true);
    expect(nodes.some((node) => node.props.children === 'Make the header simpler')).toBe(false);
  });

  it('shows the configured wake phrase while armed and steering guidance only while input is available', async () => {
    const armed = renderOverlay({ inputPhase: 'armed', phase: 'armed', wakePhrase: 'hello code' });
    expect(armed.nodes.some((node) => node.props.children === 'hello code')).toBe(true);
    const waiting = renderOverlay({ inputPhase: 'armed', phase: 'waiting', readbackPhase: 'waiting' });
    expect(waiting.nodes.some((node) => node.props.children === 'chat:overlay.steerHint:hey code')).toBe(true);
    const speaking = renderOverlay({ inputPhase: 'armed', phase: 'speaking', readbackPhase: 'speaking' });
    expect(speaking.nodes.some((node) => node.props.children === 'chat:overlay.steerHint:hey code')).toBe(false);
  });

  it.each(['connecting', 'error', 'idle'] as const)('pauses motion and shows connection feedback instead of listening when %s', async (connectionStatus) => {
    const { nodes } = renderOverlay({ connectionStatus, feedback: 'Please reconnect' });
    expect(nodes.find((node) => node.type === ConversationWave)?.props.phase).toBe('off');
    expect(nodes.some((node) => node.props.children === 'chat:overlay.phaseListening')).toBe(false);
    expect(nodes.some((node) => node.props.children === 'chat:overlay.listeningHint')).toBe(false);
    expect(nodes.some((node) => node.props.children === 'Please reconnect')).toBe(true);
  });

  it('keeps the end action clear of the bottom safe area when the keyboard is closed', async () => {
    const { root, nodes } = renderOverlay();
    // KeyboardAvoidingView owns paddingBottom and resets it to 0 when closed.
    expect(root.props.style[1].paddingBottom).toBeUndefined();
    expect(nodes.find((node) => node.props.testID === 'conversation-footer')?.props.style).toEqual({ paddingBottom: 34 });
  });

  it('shrinks the wave on small screens with large text, keeps the footer outside scrolling and allows the command to wrap', async () => {
    const normal = renderOverlay();
    const small = renderOverlay({}, { height: 568, fontScale: 2 });
    const normalWave = normal.nodes.find((node) => node.type === ConversationWave)!;
    const smallWave = small.nodes.find((node) => node.type === ConversationWave)!;
    expect(smallWave.props.height).toBeLessThan(normalWave.props.height);
    const scroll = small.nodes.find((node) => node.type === 'ScrollView')!;
    expect(descendants(scroll).some((node) => node.props.testID === 'conversation-end')).toBe(false);
    expect(small.nodes.find((node) => node.props.children === 'Make the header simpler')?.props.numberOfLines).toBeUndefined();
  });
});
