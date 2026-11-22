import { UpdateBlockingSheet as OverlaySheet } from '@/features/updates/index';
import { MarkdownText } from '@/features/chat/ui/chat-markdown';
import { Text } from '@/shared/ui/text';
import { usePalette } from '@/shared/ui/theme/use-palette';
import type { SideQuestionAnswer } from '@/shared/contracts/session-commands';

export function SideQuestionOverlay({ sideQuestion, onClose, fontSize }: {
  sideQuestion?: SideQuestionAnswer;
  onClose: () => void;
  fontSize: number;
}) {
  const palette = usePalette();

  return (
    <OverlaySheet
      visible={Boolean(sideQuestion)}
      testID="side-question-overlay"
      title="/btw"
      onClose={onClose}
      fitContent>
      {sideQuestion ? (
        <>
          <Text className="text-muted-foreground" variant="description">{sideQuestion.question}</Text>
          <MarkdownText
            codePalette={palette.code}
            color={palette.text}
            fontSize={fontSize}
            mutedColor={palette.muted}
            text={sideQuestion.answer}
            tokenColor={palette.tint}
          />
        </>
      ) : null}
    </OverlaySheet>
  );
}
