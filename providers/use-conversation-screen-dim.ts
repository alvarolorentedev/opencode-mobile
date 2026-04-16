import * as Brightness from 'expo-brightness';
import { useEffect, useRef } from 'react';

import type { ConversationPhase } from '@/providers/opencode-provider';

const CONVERSATION_DIM_BRIGHTNESS = 0.1;

export function useConversationScreenDim(phase: ConversationPhase) {
  const active = phase !== 'off';
  const previousBrightnessRef = useRef<number | null>(null);
  const previousSystemBrightnessRef = useRef<number | null>(null);
  const dimAppliedRef = useRef(false);
  const systemBrightnessAppliedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function applyDim() {
      if (!active || dimAppliedRef.current) {
        return;
      }

      const available = await Brightness.isAvailableAsync().catch(() => false);
      if (!available || cancelled) {
        return;
      }

      const currentBrightness = await Brightness.getBrightnessAsync().catch(() => null);
      const permissions = await Brightness.requestPermissionsAsync().catch(() => null);
      const canControlSystemBrightness = permissions?.granted ?? false;
      const currentSystemBrightness = canControlSystemBrightness
        ? await Brightness.getSystemBrightnessAsync().catch(() => null)
        : null;
      if (cancelled) {
        return;
      }

      previousBrightnessRef.current = currentBrightness;
      previousSystemBrightnessRef.current = currentSystemBrightness;
      systemBrightnessAppliedRef.current = canControlSystemBrightness;

      await Promise.all([
        Brightness.setBrightnessAsync(CONVERSATION_DIM_BRIGHTNESS).catch(() => undefined),
        canControlSystemBrightness
          ? Brightness.setSystemBrightnessAsync(CONVERSATION_DIM_BRIGHTNESS).catch(() => undefined)
          : Promise.resolve(),
      ]);

      if (!cancelled) {
        dimAppliedRef.current = true;
      }
    }

    async function restoreBrightness() {
      if (!dimAppliedRef.current) {
        return;
      }

      const fallbackBrightness = previousBrightnessRef.current ?? 0.5;
      const fallbackSystemBrightness = previousSystemBrightnessRef.current ?? fallbackBrightness;

      await Promise.all([
        Brightness.setBrightnessAsync(fallbackBrightness).catch(() => undefined),
        systemBrightnessAppliedRef.current
          ? Brightness.setSystemBrightnessAsync(fallbackSystemBrightness).catch(() => undefined)
          : Promise.resolve(),
      ]);

      previousBrightnessRef.current = null;
      previousSystemBrightnessRef.current = null;
      dimAppliedRef.current = false;
      systemBrightnessAppliedRef.current = false;
    }

    if (!active) {
      void restoreBrightness();
      return () => {
        cancelled = true;
      };
    }

    void applyDim();

    return () => {
      cancelled = true;
      void restoreBrightness();
    };
  }, [active]);
}
