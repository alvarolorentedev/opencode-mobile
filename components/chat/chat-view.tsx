import { withAlpha } from '@/lib/color';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardAvoidingView, Linking, Pressable, View } from 'react-native';
import { Button, Card, FAB, Snackbar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatComposer } from '@/components/chat/chat-composer';
import { PendingPrompts } from '@/components/chat/pending-prompts';
import { RevertNotice } from '@/components/chat/revert-notice';
import { ChatHeader } from '@/components/chat/chat-header';
import { ChatLibrary } from '@/components/chat/chat-library';
import { NewChatSheet } from '@/components/chat/new-chat-sheet';
import { styles } from '@/components/chat/chat-view-styles';
import { ChangesOverlay } from '@/components/chat/content/changes-overlay';
import { PendingInteractions } from '@/components/chat/content/pending-interactions';
import { TranscriptList } from '@/components/chat/content/transcript-list';
import { useChatViewController } from '@/components/chat/use-chat-view-controller';
import { ConnectionStatusBanner } from '@/components/ui/connection-status-banner';
import { useWorkspaceActions, useWorkspacePresentation } from '@/providers/workspace-context';
import { normalizeTranscriptFontSize } from '@/providers/opencode-preferences';
import { usePalette } from '@/hooks/use-palette';
import type { TranscriptEntry } from '@/lib/opencode/format';

export function ChatView() {
  const { t } = useTranslation();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { createChat, focus } = useWorkspaceActions();
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
    <FAB
      testID="chat-progress-button"
      size="small"
      icon={content.progressIcon}
      accessibilityLabel={t('chat:content.openProgressLabel', { completed: content.completedTodoCount, total: content.currentTodos.length })}
      onPress={() => actions.setProgressVisible(true)}
      style={[styles.progressFab, content.diffCount > 0 && styles.progressFabInline, { backgroundColor: palette.surfaceAlt }]}
      color={palette.tint}
    />
  ) : null;

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: palette.background }]}
        behavior="padding">
        <ChatHeader
          activeProjectLabel={header.activeProject?.label}
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

        <View style={styles.chatArea}>
          <TranscriptList
            positions={presentation}
            positionKey={`scroll:${JSON.stringify([content.workspaceId, content.currentSessionId])}`}
            activityRunning={content.activityRunning}
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
          <Card mode="contained" style={[styles.sendErrorCard, { backgroundColor: withAlpha(palette.danger, 0x14 / 255) }]}>
            <Card.Content style={styles.sendErrorContent}>
              <Text variant="titleSmall" style={{ color: palette.danger }}>{t('chat:view.actionFailed')}</Text>
              <Text selectable variant="bodySmall" style={{ color: palette.text }}>{overlay.sendErrorMessage}</Text>
              <View style={styles.sendErrorActions}>
                {overlay.hasFailedInput ? <Button compact onPress={actions.recoverFailedInput}>{t('chat:view.restoreFailedInput')}</Button> : null}
                <Button compact onPress={() => {
                  void Clipboard.setStringAsync(actions.buildSendErrorDetails()).then(() => actions.setCopiedMessageId('__send-error__'));
                }}>{t('chat:view.copyDetails')}</Button>
                <Button compact onPress={() => {
                  actions.setSendFeedback(undefined);
                  actions.dismissFailedInput();
                  actions.clearPromptError();
                }}>{t('common:actions.dismiss')}</Button>
              </View>
            </Card.Content>
          </Card>
        ) : null}

        {overlay.approvals.mcpAuth ? (
          <Card mode="contained" style={[styles.sendErrorCard, { backgroundColor: withAlpha(palette.warning, 0x14 / 255) }]}>
            <Card.Content style={styles.sendErrorContent}>
              <Text variant="titleSmall" style={{ color: palette.warning }}>{t('chat:approvals.mcpAuthTitle')}</Text>
              <Text selectable variant="bodySmall" style={{ color: palette.text }}>{t('chat:approvals.mcpAuthNeeded', { name: overlay.approvals.mcpAuth.mcpName })}</Text>
              <View style={styles.sendErrorActions}>
                <Button compact icon="open-in-new" onPress={() => {
                  const url = overlay.approvals.mcpAuth?.url;
                  if (url) {
                    void Linking.openURL(url).catch(() => undefined);
                  }
                }}>{t('chat:approvals.openAuthLink')}</Button>
                <Button compact onPress={overlay.approvals.dismissMcpAuth}>{t('common:actions.dismiss')}</Button>
              </View>
            </Card.Content>
          </Card>
        ) : null}

        {content.diffCount > 0 ? (
          <View style={styles.changesChipRow}>
            {progressAction ? <View style={styles.progressSpacer} /> : null}
            <View style={styles.changesChipCenter}>
              <Pressable
                testID="chat-changes-chip"
                accessibilityRole="button"
                accessibilityLabel={`${t('chat:cards.reviewChanges')}. ${content.currentDiffs.length > 0
                  ? t('chat:diff.filesChangedCompact', { files: content.diffCount, count: content.diffCount, additions: content.diffAdditions, deletions: content.diffDeletions })
                  : t('chat:diff.filesChangedSimple', { files: content.diffCount, count: content.diffCount })}`}
                onPress={() => { Keyboard.dismiss(); actions.setChangesVisible(true); }}
                style={({ pressed }) => [styles.changesChip, { backgroundColor: palette.surfaceAlt, opacity: pressed ? 0.75 : 1 }]}>
                <Text variant="labelLarge" style={{ color: palette.text }}>{t('chat:diff.filesChangedSimple', { files: content.diffCount, count: content.diffCount })}</Text>
                {content.currentDiffs.length > 0 ? <>
                  <Text variant="labelLarge" style={{ color: palette.success }}>+{content.diffAdditions}</Text>
                  <Text variant="labelLarge" style={{ color: palette.danger }}>−{content.diffDeletions}</Text>
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
          onCreate={createChat}
        />
      ) : null}

      <Snackbar visible={Boolean(content.copiedMessageId)} onDismiss={() => actions.setCopiedMessageId(undefined)} duration={1800}>
        {content.copiedMessageId === '__send-error__' ? t('chat:view.errorDetailsCopied') : t('chat:view.messageCopied')}
      </Snackbar>
      <Snackbar
        visible={Boolean(header.conversation.feedback || overlay.voiceFeedback)}
        onDismiss={() => {
          actions.setSendFeedback(undefined);
          actions.setVoiceFeedback(undefined);
          actions.clearConversationFeedback();
        }}
        duration={overlay.voiceRecoveryAction === 'none' ? 3200 : 6000}
        action={overlay.voiceRecoveryAction === 'none' ? undefined : {
          label: overlay.voiceRecoveryAction === 'open-settings' ? t('common:actions.openSettings') : t('common:actions.retry'),
          onPress: actions.handleVoiceRecovery,
        }}>
        {header.conversation.feedback || overlay.voiceFeedback}
      </Snackbar>
    </>
  );
}
