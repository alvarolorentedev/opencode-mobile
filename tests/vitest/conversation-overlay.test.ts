import { uiImports, textContent } from '../helpers/ui.mjs';
import { describe, expect, it, vi } from 'vitest';

import { hookRuntime, loadTs } from '../helpers/runtime.mjs';

type Element = { type: unknown; props: Record<string, any> };
const element = (type: unknown, props: Element['props']) => ({ type, props });
const jsx = { jsx: element, jsxs: element };
const native = { KeyboardAvoidingView: 'KeyboardAvoidingView', StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} }, View: 'View' };

async function loadWave(reducedMotion = false) {
  const runtime = hookRuntime();
  const shared: { value: number }[] = [];
  let motionChanged: (enabled: boolean) => void = () => {};
  const remove = vi.fn();
  const cancelAnimation = vi.fn();
  const withRepeat = vi.fn((value: number) => value);
  const withTiming = vi.fn((value: number) => value);
  const wave = await loadTs('components/chat/conversation-wave.tsx', {
    ...uiImports,
    react: { ...runtime.react, useId: () => 'wave-test' },
    'react/jsx-runtime': jsx,
    'react-native': { ...native, AccessibilityInfo: { addEventListener: (_event: string, handler: typeof motionChanged) => { motionChanged = handler; return { remove }; } } },
    'react-native-svg': { __esModule: true, default: 'Svg', Defs: 'Defs', LinearGradient: 'Gradient', Path: 'Path', Stop: 'Stop' },
    'react-native-reanimated': {
      __esModule: true, default: { createAnimatedComponent: () => 'AnimatedPath' },
      cancelAnimation, Easing: { linear: 'linear' }, useReducedMotion: () => reducedMotion,
      useSharedValue: (initial: number) => runtime.react.useMemo(() => {
        const value = { value: initial };
        shared.push(value);
        return value;
      }, []),
      useAnimatedProps: (getProps: () => unknown) => getProps(), withRepeat, withTiming,
    },
  });
  return { ...wave, runtime, shared, cancelAnimation, withRepeat, withTiming, remove, changeMotion: (enabled: boolean) => { motionChanged(enabled); runtime.flush(); } };
}

const waveProps = { phase: 'listening', level: 5, tint: '#7AE7C0', accent: '#58D4AB', height: 140 };

describe('conversation ribbon', () => {
  it('bounds microphone amplitude and ignores the microphone outside command capture', async () => {
    const { waveAmplitude } = await loadWave();
    expect(waveAmplitude('listening', -2)).toBe(0.1);
    expect(waveAmplitude('listening', NaN)).toBe(0.1);
    expect(waveAmplitude('listening', Infinity)).toBe(0.1);
    expect(waveAmplitude('listening', 10)).toBe(1);
    expect(waveAmplitude('listening', 100)).toBe(1);
    expect(waveAmplitude('listening', 2)).toBeLessThan(waveAmplitude('listening', 8));
    for (const phase of ['off', 'armed', 'submitting', 'waiting', 'speaking']) {
      expect(waveAmplitude(phase, 0)).toBe(waveAmplitude(phase, 10));
    }
    expect(waveAmplitude('off', 10)).toBe(0);
    expect(waveAmplitude('speaking', 0)).toBeGreaterThan(waveAmplitude('waiting', 0));
  });

  it('keeps all curves within the viewport, tapers the ends and loops without a jump', async () => {
    const { wavePath } = await loadWave();
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
    const wave = await loadWave();
    const root = wave.runtime.mount(wave.ConversationWave, waveProps) as Element;
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(wave.withRepeat).toHaveBeenCalledTimes(1);
    wave.runtime.update({ level: 9 });
    expect(wave.shared[1].value).toBeCloseTo(0.91);
    expect(wave.withRepeat).toHaveBeenCalledTimes(1);
    wave.runtime.update({ phase: 'off' });
    expect(wave.shared.map((value: { value: number }) => value.value)).toEqual([0, 0]);
    wave.cancelAnimation.mockClear();
    wave.runtime.unmount();
    expect(wave.cancelAnimation).toHaveBeenCalledWith(wave.shared[0]);
    expect(wave.cancelAnimation).toHaveBeenCalledWith(wave.shared[1]);
    expect(wave.remove).toHaveBeenCalledOnce();
  });

  it('renders a still ribbon with reduced motion, including changes while mounted', async () => {
    const wave = await loadWave(true);
    wave.runtime.mount(wave.ConversationWave, waveProps);
    expect(wave.withRepeat).not.toHaveBeenCalled();
    expect(wave.withTiming).not.toHaveBeenCalled();
    const stillAmplitude = wave.shared[1].value;
    wave.runtime.update({ level: 10, phase: 'speaking' });
    expect(wave.shared[1].value).toBe(stillAmplitude);
    wave.changeMotion(false);
    expect(wave.withRepeat).toHaveBeenCalledOnce();
    wave.changeMotion(true);
    expect(wave.shared[0].value).toBe(0);
    wave.runtime.update({ phase: 'off' });
    expect(wave.shared[1].value).toBe(0);
    wave.runtime.unmount();
  });
});

function descendants(root: any): Element[] {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(descendants);
  return [root, ...descendants(root.props?.children)];
}

async function renderOverlay(patch: Record<string, unknown> = {}, dimensions = { height: 844, fontScale: 1 }) {
  const palette = { background: '#0F1614', text: '#fff', muted: '#9AADA8', warning: '#ff0', tint: '#7AE7C0', accent: '#58D4AB' };
  const { ConversationOverlay } = await loadTs('components/chat/chat-overlay.tsx', {
    ...uiImports,
    'react/jsx-runtime': jsx,
    'react-native': { ...native, ScrollView: 'ScrollView', useWindowDimensions: () => dimensions },

    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) },
    'react-i18next': { useTranslation: () => ({ t: (key: string, args?: { phrase: string }) => args ? `${key}:${args.phrase}` : key }) },
    '@/components/chat/conversation-wave': { ConversationWave: 'ConversationWave' },
    '@/components/chat/conversation-confirmation': { ConversationConfirmation: 'ConversationConfirmation' },
    '@/constants/theme': { Fonts: { display: 'Avenir Next' }, getColors: () => palette },
    '@/providers/appearance-context': { useAppearance: () => ({ accent: 'green' }) },
  });
  const onStop = vi.fn();
  const root = ConversationOverlay({
    connectionStatus: 'connected', inputPhase: 'listening', insetsTop: 44, latestUserText: 'Make the header simpler',
    level: 7, onStop, phase: 'listening', readbackPhase: 'idle', sessionTitle: 'Refine the home screen', wakePhrase: 'hey code', ...patch,
  }) as Element;
  return { root, nodes: descendants(root), onStop };
}

describe('conversation overlay', () => {
  it('passes the live meter, retains the heard command and invokes the existing stop action', async () => {
    const { root, nodes, onStop } = await renderOverlay();
    expect(root.props.accessibilityViewIsModal).toBe(true);
    expect(nodes.find((node) => node.type === 'ConversationWave')?.props).toMatchObject({ phase: 'listening', level: 7 });
    expect(nodes.some((node) => node.props.children === 'Make the header simpler')).toBe(true);
    const end = nodes.find((node) => node.props.testID === 'conversation-end')!;
    expect(textContent(end)).toBe('chat:overlay.endConversation');
    end.props.onPress();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('hands an active confirmation to the dedicated card instead of the last-heard snippet', async () => {
    const confirmation = {
      active: true,
      phase: 'listening',
      text: 'Refactor the login component',
      speaking: false,
      actions: { cancel: vi.fn(), confirm: vi.fn(), edit: vi.fn(), retry: vi.fn() },
    };
    const { nodes } = await renderOverlay({ confirmation, inputPhase: 'confirming', phase: 'confirming' });
    expect(nodes.find((node) => node.type === 'ConversationConfirmation')?.props.confirmation).toBe(confirmation);
    expect(nodes.some((node) => node.props.children === 'chat:overlay.phaseConfirming:hey code')).toBe(true);
    expect(nodes.some((node) => node.props.children === 'Make the header simpler')).toBe(false);
  });

  it('shows the configured wake phrase while armed and steering guidance only while input is available', async () => {
    const armed = await renderOverlay({ inputPhase: 'armed', phase: 'armed', wakePhrase: 'hello code' });
    expect(armed.nodes.some((node) => node.props.children === 'hello code')).toBe(true);
    const waiting = await renderOverlay({ inputPhase: 'armed', phase: 'waiting', readbackPhase: 'waiting' });
    expect(waiting.nodes.some((node) => node.props.children === 'chat:overlay.steerHint:hey code')).toBe(true);
    const speaking = await renderOverlay({ inputPhase: 'armed', phase: 'speaking', readbackPhase: 'speaking' });
    expect(speaking.nodes.some((node) => node.props.children === 'chat:overlay.steerHint:hey code')).toBe(false);
  });

  it.each(['connecting', 'error', 'idle'])('pauses motion and shows connection feedback instead of listening when %s', async (connectionStatus) => {
    const { nodes } = await renderOverlay({ connectionStatus, feedback: 'Please reconnect' });
    expect(nodes.find((node) => node.type === 'ConversationWave')?.props.phase).toBe('off');
    expect(nodes.some((node) => node.props.children === 'chat:overlay.phaseListening')).toBe(false);
    expect(nodes.some((node) => node.props.children === 'chat:overlay.listeningHint')).toBe(false);
    expect(nodes.some((node) => node.props.children === 'Please reconnect')).toBe(true);
  });

  it('shrinks the wave on small screens with large text, keeps the footer outside scrolling and allows the command to wrap', async () => {
    const normal = await renderOverlay();
    const small = await renderOverlay({}, { height: 568, fontScale: 2 });
    const normalWave = normal.nodes.find((node) => node.type === 'ConversationWave')!;
    const smallWave = small.nodes.find((node) => node.type === 'ConversationWave')!;
    expect(smallWave.props.height).toBeLessThan(normalWave.props.height);
    const scroll = small.nodes.find((node) => node.type === 'ScrollView')!;
    expect(descendants(scroll).some((node) => node.props.testID === 'conversation-end')).toBe(false);
    expect(small.nodes.find((node) => node.props.children === 'Make the header simpler')?.props.numberOfLines).toBeUndefined();
  });
});
