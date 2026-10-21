import { memo, useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { styles } from '@/components/chat/chat-view-styles';
import { Colors } from '@/constants/theme';

type Palette = typeof Colors.light;

// Skeleton placeholder shown during the initial transcript fetch. Avoids the
// "blank → populated list" snap users can read as a lock-up. Subtle opacity
// pulse (1.2s loop, native driver) signals active loading without thrashing
// the JS thread.
function TranscriptSkeletonImpl({ palette }: { palette: Palette }) {
  const [opacity] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 600, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  // Three placeholder bubbles mimic a typical user/assistant turn shape.
  const rows: { role: 'user' | 'assistant'; width: `${number}%` }[] = [
    { role: 'user', width: '60%' },
    { role: 'assistant', width: '90%' },
    { role: 'assistant', width: '75%' },
  ];
  return (
    <View testID="transcript-skeleton" style={styles.transcriptItem}>
      {rows.map((row, index) => (
        <Animated.View
          key={`skeleton-${index}`}
          style={[
            styles.skeletonRow,
            row.role === 'user' ? styles.skeletonUser : styles.skeletonAssistant,
            { width: row.width, backgroundColor: palette.surface, opacity },
          ]}
        />
      ))}
    </View>
  );
}

export const TranscriptSkeleton = memo(TranscriptSkeletonImpl);
