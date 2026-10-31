import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { CardContent, Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';


import { PendingInteractionsCard, QuestionFlow } from '@/components/chat/chat-cards';
import { styles , stylesClasses} from '@/components/chat/chat-view-styles';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { Colors } from '@/constants/theme';
import type { PendingPermission, PendingQuestion, PendingQuestionAnswer } from '@/lib/opencode/client';
import type { Todo } from '@/lib/opencode/types';

type Palette = typeof Colors.light;

type PendingInteractionsProps = {
  changesVisible: boolean;
  currentPendingPermissions: PendingPermission[];
  currentPendingQuestions: PendingQuestion[];
  currentTodos: Todo[];
  diffCount: number;
  onCloseProgress: () => void;
  onRejectQuestion: (requestId: string) => Promise<void>;
  onReplyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  onReplyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => Promise<void>;
  palette: Palette;
  progressAction?: ReactNode;
  progressVisible: boolean;
};

export function PendingInteractions({
  changesVisible,
  currentPendingPermissions,
  currentPendingQuestions,
  currentTodos,
  diffCount,
  onCloseProgress,
  onRejectQuestion,
  onReplyToPermission,
  onReplyToQuestion,
  palette,
  progressAction,
  progressVisible,
}: PendingInteractionsProps) {
  const { t } = useTranslation();
  const [dismissedQuestionId, setDismissedQuestionId] = useState<string>();
  const currentQuestion = currentPendingQuestions[0];

  return (
    <>
      {currentQuestion ? (
        <QuestionFlow
          key={currentQuestion.id}
          request={currentQuestion}
          sourceTitle={currentQuestion.sourceTitle}
          visible={dismissedQuestionId !== currentQuestion.id}
          onDismiss={() => setDismissedQuestionId(currentQuestion.id)}
          onReject={() => onRejectQuestion(currentQuestion.id)}
          onReply={(answers) => onReplyToQuestion(currentQuestion.id, answers)}
        />
      ) : null}

      {currentPendingPermissions.length > 0 && !currentQuestion ? (
        <ScrollView keyboardShouldPersistTaps="handled" className={cn("max-h-[75%]")} style={[styles.todoOverlay]}>
          <PendingInteractionsCard permissions={currentPendingPermissions} onPermissionReply={onReplyToPermission} />
        </ScrollView>
      ) : null}
      {currentQuestion && dismissedQuestionId === currentQuestion.id ? (
        <Card className={cn("bg-surface border-border")} style={[styles.todoOverlay]}><CardContent className={cn(stylesClasses.todoHeader)}><View className={cn(stylesClasses.todoSummary)}>
              <Text className={cn("text-foreground")} variant="description">{t('chat:content.answerNeeded')}</Text>
              <Text className={cn("text-muted-foreground")} variant="label">{currentQuestion.title || t('chat:content.waitingForAnswer')}</Text>
            </View><Button onPress={() => setDismissedQuestionId(undefined)} variant="ghost"><Text>{t('common:actions.open')}</Text></Button></CardContent></Card>
      ) : null}
      {diffCount === 0 ? progressAction : null}
      <OverlaySheet visible={!changesVisible && !currentQuestion && currentPendingPermissions.length === 0 && progressVisible} testID="progress-overlay" title={t('chat:content.progress')} fitContent onClose={onCloseProgress}>
        {currentTodos.map((todo, index) => <View key={`${todo.content}-${index}`} className={cn(stylesClasses.todoItemRow)}>
          <Button disabled variant="ghost" size="icon" className={cn(stylesClasses.todoStatusIcon)} ><Icon name={todo.status === 'completed' ? 'check-circle' : todo.status === 'in_progress' ? 'progress-clock' : 'circle-outline'} size={20} /></Button>
          <View className={cn(stylesClasses.todoTextWrap)}><Text className={cn("text-foreground")} variant="description">{todo.content || t('chat:content.untitledTask')}</Text>{todo.priority ? <Text className={cn("text-muted-foreground")} variant="label">{todo.priority}</Text> : null}</View>
        </View>)}
      </OverlaySheet>
    </>
  );
}
