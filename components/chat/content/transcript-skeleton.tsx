import { cn } from '@/lib/utils';
import { memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { View } from 'react-native';

import { styles , stylesClasses} from '@/components/chat/chat-view-styles';
import { Colors } from '@/constants/theme';

type Palette = typeof Colors.light;

// Shared static placeholders also respect reduced-motion preferences.
function TranscriptSkeletonImpl({ palette }: { palette: Palette }) {
  // Three placeholder bubbles mimic a typical user/assistant turn shape.
  const rows: { role: 'user' | 'assistant'; width: `${number}%` }[] = [
    { role: 'user', width: '60%' },
    { role: 'assistant', width: '90%' },
    { role: 'assistant', width: '75%' },
  ];
  return (
    <View testID="transcript-skeleton" className={cn(stylesClasses.transcriptItem)}>
      {rows.map((row, index) => (
        <Skeleton
          key={`skeleton-${index}`}
          style={[
            styles.skeletonRow,
            row.role === 'user' ? styles.skeletonUser : styles.skeletonAssistant,
            { width: row.width, backgroundColor: palette.surface },
          ]}
        />
      ))}
    </View>
  );
}

export const TranscriptSkeleton = memo(TranscriptSkeletonImpl);
