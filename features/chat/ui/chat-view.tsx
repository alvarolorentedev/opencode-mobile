import { cn } from '@/shared/ui/cn';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { CardContent, Card } from '@/shared/ui/card';
import { Feedback } from '@/shared/ui/feedback';
import { withAlpha } from '@/shared/ui/theme/color';
import * as Clipboard from '@/shared/platform/clipboard';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Linking, Pressable, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatComposer } from '@/features/chat/ui/chat-composer';
import { PendingPrompts } from '@/features/chat/ui/pending-prompts';
import { RevertNotice } from '@/features/chat/ui/revert-notice';
import { ChatHeader } from '@/features/chat/ui/chat-header';
import { ChatLibrary , NewChatSheet } from '@/features/sessions/index';
import { styles, stylesClasses } from '@/features/chat/ui/chat-view-styles';
import { ChangesOverlay } from '@/features/chat/ui/content/changes-overlay';
import { PendingInteractions } from '@/features/chat/ui/content/pending-interactions';
import { TranscriptList } from '@/features/chat/ui/content/transcript-list';
import { useChatViewController } from '@/features/chat/ui/use-chat-view-controller';
import { ConnectionStatusBanner } from '@/features/connections/index';
import { useWorkspaceActions, useWorkspacePresentation } from '@/runtime/workspace';
import { normalizeTranscriptFontSize } from '@/shared/preferences/opencode-preferences';
import { usePalette } from '@/shared/ui/theme/use-palette';
import type { TranscriptEntry } from '@/shared/presentation/format';

export function ChatView() {
  const { t } = useTranslation();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { focus } = useWorkspaceActions();
  const presentation = useWorkspacePresentation();
  const { header, content, composer, overlay, actions } = useChatViewController();
  const {
    handleCopyMessage: copyMessage,
    forkSession,
    handleRevertMessage: revertMessage,
    setDraft,
    setSendFeedback,
    handleSpeakEntry,
  } = actions;
  const [newChatVisible, setNewChatVisible] = useState(false);

  const handleCopyMessage = useCallback((entry: TranscriptEntry) => {
    void copyMessage(entry);
  }, [copyMessage]);
  const handleForkMessage = useCallback((entry: TranscriptEntry) => {
    if (!content.currentSessionId) return;
    void forkSession(content.currentSessionId, entry.id)
      .catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotFork')));
  }, [content.currentSessionId, forkSession, setSendFeedback, t]);
  const handleRevertMessage = useCallback((entry: TranscriptEntry) => {
    const sessionId = content.currentSessionId;
    if (!sessionId) return;
    void revertMessage(sessionId, entry.id)
      .catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRevert')));
  }, [content.currentSessionId, revertMessage, setSendFeedback, t]);
  const handleSelectStarterPrompt = useCallback((prompt: string) => {
    setDraft(prompt);
  }, [setDraft]);
  const handleToggleSpeak = useCallback((entry: TranscriptEntry) => {
    void handleSpeakEntry(entry);
  }, [handleSpeakEntry]);

  const progressAction = !content.awaitingUserInput && content.currentTodos.length > 0 ? (
    <Button testID="chat-progress-button" accessibilityLabel={t('chat:content.openProgressLabel', { completed: content.completedTodoCount, total: content.currentTodos.length })} onPress={() => actions.setProgressVisible(true)} variant="ghost" size="icon" className={cn("absolute right-3 bottom-2 z-2 rounded-3xl w-12 h-12 items-center justify-center bg-surface-alt", content.diffCount > 0 && stylesClasses.progressFabInline)}><Icon name={content.progressIcon} size={24} color={palette.tint} /></Button>
  ) : null;

  return (
    <>{actions.confirmation}
      <KeyboardAvoidingView
        className={cn(stylesClasses.screen, "bg-background")}
        behavior="padding">
        <ChatHeader
          connectionStatus={header.connection.status}
          conversation={header.conversation}
          contextLimit={header.contextModel?.contextLimit}
          contextTokens={header.contextTokens}
          insetsTop={insets.top}
          onConfirmStopConversation={actions.handleConfirmStopConversation}
          onCreateSession={() => setNewChatVisible(true)}
          onOpenSessionMenu={() => actions.setSessionMenuVisible(true)}
          palette={palette}
          selectedSession={header.selectedSession}
          latestAssistantTurnUsage={header.latestAssistantTurnUsage}
          slim={header.slim}
          usage={header.currentUsage}
        />

        <ConnectionStatusBanner />

        <View className={cn(stylesClasses.chatArea)}>
          <TranscriptList
            positions={presentation}
            positionKey={`scroll:${JSON.stringify([content.workspaceId, content.currentSessionId])}`}
            activityRunning={content.activityRunning}
            activityStatusLabel={content.activityStatusLabel}
            connection={header.connection}
            copiedMessageId={content.copiedMessageId}
            currentSessionId={content.currentSessionId}
            transcriptRows={content.transcriptRows}
            flatTranscript={composer.chatPreferences.flatTranscript === true}
            hasMessages={content.hasTranscriptMessages}
            hasOlderMessages={content.transcriptPaging.hasOlder}
            isBootstrappingChat={content.isBootstrappingChat}
            isLoadingOlderMessages={content.transcriptPaging.isLoadingOlder}
            isRefreshingMessages={content.isRefreshingMessages}
            onCopyMessage={handleCopyMessage}
            onForkMessage={handleForkMessage}
            onLoadOlderMessages={() => {
              if (!content.currentSessionId || content.transcriptPaging.isLoadingOlder || !content.transcriptPaging.hasOlder) return;
              void content.transcriptPaging.loadOlder(content.currentSessionId);
            }}
            onRetryTranscript={() => { void content.retryTranscript(); }}
            onRevertMessage={handleRevertMessage}
            onSelectStarterPrompt={handleSelectStarterPrompt}
            onToggleSpeak={handleToggleSpeak}
            palette={palette}
            pendingInteractions={content.pendingInteractions}
            speakingMessageId={content.speakingMessageId}
            slim={header.slim}
            transcriptFontSize={normalizeTranscriptFontSize(composer.chatPreferences.transcriptFontSize)}
            transcriptReadError={content.transcriptReadError}
          />
          <ChangesOverlay
            changesVisible={content.changesVisible && !content.awaitingUserInput}
            connection={header.connection}
            currentDiffScope={content.currentDiffScope}
            currentDiffs={content.currentDiffs}
            currentSessionId={content.currentSessionId}
            diffCount={content.diffCount}
            diffDetails={content.diffDetails}
            diffTurns={content.diffTurns}
            expandedDiffId={content.expandedDiffId}
            onCloseChanges={() => actions.setChangesVisible(false)}
            onExpandDiff={actions.setExpandedDiffId}
            onSelectDiffMessage={actions.selectDiffMessage}
            onSelectDiffScope={actions.setDiffScope}
            palette={palette}
            selectedDiffMessageId={content.selectedDiffMessageId}
          />
          <PendingInteractions
            changesVisible={content.changesVisible && !content.awaitingUserInput}
            currentPendingPermissions={content.currentPendingPermissions}
            currentPendingQuestions={content.currentPendingQuestions}
            currentTodos={content.currentTodos}
            diffCount={content.diffCount}
            onCloseProgress={() => actions.setProgressVisible(false)}
            onRejectQuestion={(requestId) => actions.rejectQuestion(requestId).catch((error) => { actions.setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRejectQuestion')); throw error; })}
            onReplyToPermission={(requestId, reply) => actions.replyToPermission(requestId, reply).catch((error) => { actions.setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotReplyPermission')); })}
            onReplyToQuestion={(requestId, answers) => actions.replyToQuestion(requestId, answers).catch((error) => { actions.setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotAnswerQuestion')); throw error; })}
            palette={palette}
            progressAction={progressAction}
            progressVisible={content.progressVisible}
          />
        </View>

        {overlay.sendErrorMessage ? (
          <Card className={cn(stylesClasses.sendErrorCard)} style={[{ backgroundColor: withAlpha(palette.danger, 0x14 / 255) }]}><CardContent className={cn(stylesClasses.sendErrorContent)}><Text className={cn("text-destructive")} variant="description">{t('chat:view.actionFailed')}</Text><Text selectable className={cn("text-foreground")} variant="label">{overlay.sendErrorMessage}</Text><View className={cn(stylesClasses.sendErrorActions)}>
                {overlay.hasFailedInput ? <Button onPress={actions.recoverFailedInput} variant="ghost"><Text>{t('chat:view.restoreFailedInput')}</Text></Button> : null}
                <Button onPress={() => {
                  void Clipboard.setStringAsync(actions.buildSendErrorDetails()).then(() => actions.setCopiedMessageId('__send-error__'));
                }} variant="ghost"><Text>{t('chat:view.copyDetails')}</Text></Button>
                <Button onPress={() => {
                  actions.setSendFeedback(undefined);
                  actions.dismissFailedInput();
                  actions.clearPromptError();
                }} variant="ghost"><Text>{t('common:actions.dismiss')}</Text></Button>
              </View></CardContent></Card>
        ) : null}

        {overlay.approvals.mcpAuth ? (
          <Card className={cn(stylesClasses.sendErrorCard)} style={[{ backgroundColor: withAlpha(palette.warning, 0x14 / 255) }]}><CardContent className={cn(stylesClasses.sendErrorContent)}><Text className={cn("text-warning")} variant="description">{t('chat:approvals.mcpAuthTitle')}</Text><Text selectable className={cn("text-foreground")} variant="label">{t('chat:approvals.mcpAuthNeeded', { name: overlay.approvals.mcpAuth.mcpName })}</Text><View className={cn(stylesClasses.sendErrorActions)}>
                <Button onPress={() => {
                  const url = overlay.approvals.mcpAuth?.url;
                  if (url) {
                    void Linking.openURL(url).catch(() => undefined);
                  }
                }} variant="ghost"><Icon name={"open-in-new"} size={20} /><Text>{t('chat:approvals.openAuthLink')}</Text></Button>
                <Button onPress={overlay.approvals.dismissMcpAuth} variant="ghost"><Text>{t('common:actions.dismiss')}</Text></Button>
              </View></CardContent></Card>
        ) : null}

        {content.diffCount > 0 ? (
          <View className={cn(stylesClasses.changesChipRow)}>
            {progressAction ? <View className={cn(stylesClasses.progressSpacer)} /> : null}
            <View className={cn(stylesClasses.changesChipCenter)}>
              <Pressable
                testID="chat-changes-chip"
                accessibilityRole="button"
                accessibilityLabel={`${t('chat:cards.reviewChanges')}. ${content.currentDiffs.length > 0
                  ? t('chat:diff.filesChangedCompact', { files: content.diffCount, count: content.diffCount, additions: content.diffAdditions, deletions: content.diffDeletions })
                  : t('chat:diff.filesChangedSimple', { files: content.diffCount, count: content.diffCount })}`}
                onPress={() => { actions.setChangesVisible(true); }}
                style={({ pressed }) => [styles.changesChip, { backgroundColor: palette.surfaceAlt, opacity: pressed ? 0.75 : 1 }]}>
                <Text className={cn("text-foreground")} variant="description">{t('chat:diff.filesChangedSimple', { files: content.diffCount, count: content.diffCount })}</Text>
                {content.currentDiffs.length > 0 ? <>
                  <Text className={cn("text-success")} variant="description">+{content.diffAdditions}</Text>
                  <Text className={cn("text-destructive")} variant="description">−{content.diffDeletions}</Text>
                </> : null}
              </Pressable>
            </View>
            {progressAction}
          </View>
        ) : null}

        {content.activeSession?.revert ? (
          <RevertNotice
            busy={content.isCancelingRevert}
            onCancel={() => {
              const sessionId = content.currentSessionId;
              if (!sessionId) return;
              void actions.handleCancelRevert(sessionId).catch((error) => actions.setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRestore')));
            }}
          />
        ) : null}
        <PendingPrompts
          key={content.currentSessionId}
          cancelingId={content.cancelingPromptId}
          onCancel={(prompt) => {
            void actions.handleCancelPendingPrompt(prompt).catch((error) => actions.setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotCancelPending')));
          }}
          prompts={content.pendingPrompts}
        />
        <ChatComposer
          key={`${content.currentSessionId}:${content.currentPendingPermissions.map((item) => item.id).join()}:${content.currentPendingQuestions.map((item) => item.id).join()}`}
          attachments={composer.attachments}
          autoApproveAvailable={composer.serverCapabilities.autoApprove}
          availableAgents={composer.availableAgents}
          chatPreferences={composer.chatPreferences}
          connectionStatus={header.connection.status}
          conversation={header.conversation}
          currentSessionId={content.currentSessionId}
          commands={composer.commands}
          draft={composer.draft}
          isSpeechInputAvailable={composer.isSpeechInputAvailable}
          isSpeechInputListening={composer.isSpeechInputListening}
          isStoppingSession={composer.isStoppingSession}
          isUpdatingAutoApprove={composer.isUpdatingAutoApprove}
          onToggleConversationMode={() => void actions.toggleConversationMode()}
          onAttach={() => void actions.handleAttach()}
          onDraftChange={actions.handleDraftChange}
          isV2={composer.isV2}
          suggestions={composer.suggestions}
          suggestionsActive={composer.suggestionsActive}
          suggestionsSearching={composer.suggestionsSearching}
          suggestionsError={composer.suggestionsError}
          onSuggestionSelect={actions.handleSuggestionSelect}
          onSelectionChange={actions.handleSelectionChange}
          shellMode={composer.shellMode}
          focusRequest={composer.focusRequest}
          onRemoveAttachment={(index) => {
            actions.setSendFeedback(undefined);
            actions.setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
          }}
          onSend={() => {
            if (!composer.showSendAction) {
              void actions.handleAbort();
              return;
            }

            void actions.handleSendPrompt();
          }}
          onToggleAutoApprove={async () => {
            actions.setSendFeedback(undefined);
            actions.setIsUpdatingAutoApprove(true);
            try {
              await actions.setAutoApprove(!composer.chatPreferences.autoApprove);
              return true;
            } catch (error) {
              actions.setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotUpdateAutoApprove'));
              return false;
            } finally {
              actions.setIsUpdatingAutoApprove(false);
            }
          }}
          onToggleRecording={() => void actions.handleToggleRecording()}
          palette={palette}
          selectedAgentLabel={composer.selectedAgentLabel}
          showSendAction={composer.showSendAction}
          selectedVariant={composer.selectedVariant}
          autoRoutingEnabled={composer.autoRoutingEnabled}
          autoRoutingAvailable={composer.autoRoutingAvailable}
          onAutoRoutingChange={composer.onAutoRoutingChange}
          slim={header.slim}
          updateChatPreferences={actions.updateChatPreferences}
          visibleModels={composer.visibleModels}
        />
      </KeyboardAvoidingView>

      <ChatLibrary
        visible={overlay.sessionMenuVisible}
        onClose={() => actions.setSessionMenuVisible(false)}
        onNewChat={() => {
          actions.setSessionMenuVisible(false);
          setNewChatVisible(true);
        }}
      />
      {newChatVisible ? (
        <NewChatSheet
          target={focus ? { ...focus, projectPath: header.activeProject?.path ?? focus.projectPath } : undefined}
          onClose={() => setNewChatVisible(false)}
        />
      ) : null}

      <Feedback duration={1800} open={Boolean(content.copiedMessageId)} onOpenChange={() => (() => actions.setCopiedMessageId(undefined))()}>{content.copiedMessageId === '__send-error__' ? t('chat:view.errorDetailsCopied') : t('chat:view.messageCopied')}</Feedback>
      <Feedback duration={overlay.voiceRecoveryAction === 'none' ? 3200 : 6000} action={overlay.voiceRecoveryAction === 'none' ? undefined : {
          label: overlay.voiceRecoveryAction === 'open-settings' ? t('common:actions.openSettings') : t('common:actions.retry'),
          onPress: actions.handleVoiceRecovery,
        }} open={Boolean(header.conversation.feedback || overlay.voiceFeedback)} onOpenChange={() => (() => {
          actions.setSendFeedback(undefined);
          actions.setVoiceFeedback(undefined);
          actions.clearConversationFeedback();
        })()}>{header.conversation.feedback || overlay.voiceFeedback}</Feedback>
    </>
  );
}
