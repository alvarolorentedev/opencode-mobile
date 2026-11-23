import { UpdateBlockingSheet as OverlaySheet } from '@/features/updates/index';
import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { CardContent, Card } from '@/shared/ui/card';
import { Icon } from '@/shared/ui/icon';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { PermissionActions, PermissionRequestDetails, QuestionFlow } from '@/features/sessions/index';
import { styles, stylesClasses } from '@/features/chat/ui/chat-view-styles';
import { Colors } from '@/shared/ui/theme/theme';
import type { PendingPermission, PendingQuestion, PendingQuestionAnswer } from '@/shared/protocol/opencode/client';
import type { Todo } from '@/shared/protocol/opencode/types';

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
  const currentPermission = currentPendingPermissions[0];

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

      {currentPermission && !currentQuestion ? (
        <View className={cn("max-h-[90%] gap-3 border-border bg-surface px-4 py-3")} style={[styles.todoOverlay]}>
          <View className={cn(stylesClasses.permissionHeader)}>
            <Icon name="message-alert-outline" size={18} color={palette.text} />
            <Text className={cn("text-foreground")} variant="title">{t('chat:cards.respondToContinue')}</Text>
            {currentPendingPermissions.length > 1 ? (
              <Text className={cn("text-muted-foreground", stylesClasses.permissionCount)} variant="label">{t('chat:cards.stepOfTotal', { current: 1, total: currentPendingPermissions.length })}</Text>
            ) : null}
          </View>
          <ScrollView key={`permission:${currentPermission.id}`} className={cn(stylesClasses.permissionScroll)} keyboardShouldPersistTaps="handled">
            <View className={cn(stylesClasses.permissionDetails)}>
              <Text className={cn("text-muted-foreground")} variant="label">{t('chat:cards.waitingForAnswer')}</Text>
              <PermissionRequestDetails request={currentPermission} sourceTitle={currentPermission.sourceTitle} />
            </View>
          </ScrollView>
          <PermissionActions key={currentPermission.id} onReply={(reply) => onReplyToPermission(currentPermission.id, reply)} />
        </View>
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
