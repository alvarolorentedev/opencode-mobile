import * as Brightness from 'expo-brightness';
import { useEffect, useRef } from 'react';

import type { ConversationPhase } from '@/providers/opencode-provider';

const CONVERSATION_DIM_BRIGHTNESS = 0.1;

export function useConversationScreenDim(phase: ConversationPhase) {
  const active = phase !== 'off';
  const previousBrightnessRef = useRef<number | null>(null);
  const dimAppliedRef = useRef(false);

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
      if (cancelled) {
        return;
      }

      previousBrightnessRef.current = currentBrightness;
      await Brightness.setBrightnessAsync(CONVERSATION_DIM_BRIGHTNESS).catch(() => undefined);
      if (!cancelled) {
        dimAppliedRef.current = true;
      }
    }

    async function restoreBrightness() {
      if (!dimAppliedRef.current) {
        return;
      }

      const fallbackBrightness = previousBrightnessRef.current ?? 0.5;
      await Brightness.setBrightnessAsync(fallbackBrightness).catch(() => undefined);
      previousBrightnessRef.current = null;
      dimAppliedRef.current = false;
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
