import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';

// FlashList measures progressively, so re-assert the tail across a few frames.
const TAIL_SETTLE_FRAMES = 4;

export function useTranscriptTailSettle<Row>({ focused, transcriptRef, transcriptRowsRef, followTailRef, draggingRef }: {
  focused: boolean;
  transcriptRef: RefObject<FlashListRef<Row> | null>;
  transcriptRowsRef: RefObject<Row[]>;
  followTailRef: RefObject<boolean>;
  draggingRef: RefObject<boolean>;
}) {
  const settleFramesRef = useRef(0);
  const settleFrameRef = useRef<number | undefined>(undefined);
  const resizeSettlingRef = useRef(false);
  const layoutHeightRef = useRef<number | undefined>(undefined);
  const scrollHeightRef = useRef<number | undefined>(undefined);

  const cancelTailSettle = useCallback(() => {
    if (settleFrameRef.current !== undefined) cancelAnimationFrame(settleFrameRef.current);
    settleFrameRef.current = undefined;
    settleFramesRef.current = 0;
    resizeSettlingRef.current = false;
  }, []);

  const settleToTail = useCallback(() => {
    settleFramesRef.current = TAIL_SETTLE_FRAMES;
    if (settleFrameRef.current !== undefined) return;
    const run = () => {
      settleFrameRef.current = undefined;
      if (!followTailRef.current || draggingRef.current || transcriptRowsRef.current.length === 0) {
        cancelTailSettle();
        return;
      }
      transcriptRef.current?.scrollToEnd({ animated: false });
      settleFramesRef.current -= 1;
      if (settleFramesRef.current > 0) settleFrameRef.current = requestAnimationFrame(run);
      else resizeSettlingRef.current = false;
    };
    settleFrameRef.current = requestAnimationFrame(run);
  }, [cancelTailSettle, draggingRef, followTailRef, transcriptRef, transcriptRowsRef]);

  useEffect(() => cancelTailSettle, [cancelTailSettle]);

  const measureViewport = useCallback((height: number, measurement: RefObject<number | undefined>) => {
    if (height <= 0) return false;
    const previousHeight = measurement.current ?? layoutHeightRef.current;
    measurement.current = height;
    if (previousHeight === undefined || Math.abs(previousHeight - height) < 1) return false;
    if (focused && followTailRef.current && !draggingRef.current && transcriptRowsRef.current.length > 0) {
      resizeSettlingRef.current = true;
      settleToTail();
    }
    return true;
  }, [draggingRef, focused, followTailRef, settleToTail, transcriptRowsRef]);

  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    measureViewport(event.nativeEvent.layout.height, layoutHeightRef);
  }, [measureViewport]);

  const preserveFollowOnScroll = useCallback((height: number) => {
    if (Platform.OS !== 'android') return false;
    // The scroll event can report the new viewport before its layout event.
    return measureViewport(height, scrollHeightRef) || resizeSettlingRef.current;
  }, [measureViewport]);

  return {
    cancelTailSettle,
    onViewportLayout: Platform.OS === 'android' ? onViewportLayout : undefined,
    preserveFollowOnScroll,
    settleToTail,
  };
}
