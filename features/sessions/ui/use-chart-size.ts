import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

export function useChartSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = {
      width: Math.floor(event.nativeEvent.layout.width),
      height: Math.floor(event.nativeEvent.layout.height),
    };
    setSize((current) => current.width === next.width && current.height === next.height ? current : next);
  }, []);
  return { ...size, onLayout };
}
