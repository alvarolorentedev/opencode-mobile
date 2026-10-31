import { cn } from '@/shared/ui/cn';
import { useEffect, useId, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import type { ConversationPhase } from '@/features/voice/model/types';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function waveAmplitude(phase: ConversationPhase, level: number) {
  if (phase === 'off') return 0;
  if (phase === 'armed') return 0.08;
  if (phase === 'speaking') return 0.65;
  if (phase !== 'listening') return 0.2;
  const volume = Number.isFinite(level) ? Math.min(10, Math.max(0, level)) / 10 : 0;
  // shortcut: local capture has no meter; keep a quiet wave until it exposes one.
  return 0.1 + volume * 0.9;
}

export function wavePath(amplitude: number, progress: number, offset: number) {
  'worklet';
  let path = '';
  for (let index = 0; index <= 64; index++) {
    const position = index / 64;
    const envelope = Math.pow(Math.sin(position * Math.PI), 1.3);
    const angle = position * Math.PI * 3.5 - progress + offset;
    const displacement = Math.sin(angle) * 0.8 + Math.sin(angle * 1.5 + offset) * 0.2;
    const y = 70 + displacement * envelope * amplitude * 50;
    path += `${index === 0 ? 'M' : 'L'}${position * 360},${y} `;
  }
  return path;
}

function WaveLine({ amplitude, progress, offset, stroke }: {
  amplitude: SharedValue<number>;
  progress: SharedValue<number>;
  offset: number;
  stroke: string;
}) {
  const animatedProps = useAnimatedProps(() => ({ d: wavePath(amplitude.value, progress.value, offset) }));
  return (
    <>
      <AnimatedPath animatedProps={animatedProps} fill="none" stroke={stroke} strokeWidth={16} opacity={0.06} />
      <AnimatedPath animatedProps={animatedProps} fill="none" stroke={stroke} strokeWidth={7} opacity={0.16} />
      <AnimatedPath animatedProps={animatedProps} fill="none" stroke={stroke} strokeWidth={2.2} opacity={1 - offset * 0.3} />
    </>
  );
}

export function ConversationWave({ phase, level, tint, accent, height }: {
  phase: ConversationPhase;
  level: number;
  tint: string;
  accent: string;
  height: number;
}) {
  const gradientId = useId();
  const initiallyReducedMotion = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(initiallyReducedMotion);
  const progress = useSharedValue(0);
  const amplitude = useSharedValue(0);
  const target = waveAmplitude(phase, level);

  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    amplitude.value = reducedMotion ? (phase === 'off' ? 0 : 0.15) : withTiming(target, { duration: 180 });
    return () => cancelAnimation(amplitude);
  }, [amplitude, phase, reducedMotion, target]);

  useEffect(() => {
    progress.value = 0;
    if (!reducedMotion && phase !== 'off') {
      const duration = phase === 'armed' ? 5600 : phase === 'speaking' ? 2200 : phase === 'listening' ? 3000 : 4200;
      // One full cycle includes the secondary wave, so repeating has no seam.
      progress.value = withRepeat(withTiming(Math.PI * 4, { duration, easing: Easing.linear }), -1, false);
    }
    return () => cancelAnimation(progress);
  }, [phase, progress, reducedMotion]);

  return (
    <View testID="conversation-wave" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className={cn(stylesClasses.wave)} style={[{ height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 140" accessible={false}>
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0" stopColor={accent} stopOpacity={0} />
            <Stop offset="0.2" stopColor={tint} stopOpacity={0.8} />
            <Stop offset="0.5" stopColor={tint} />
            <Stop offset="0.8" stopColor={accent} stopOpacity={0.8} />
            <Stop offset="1" stopColor={accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {[0, 0.6, 1.2].map((offset) => (
          <WaveLine key={offset} amplitude={amplitude} progress={progress} offset={offset} stroke={`url(#${gradientId})`} />
        ))}
      </Svg>
    </View>
  );
}

const stylesClasses = {
  "wave": "w-full shrink"
} as const;
