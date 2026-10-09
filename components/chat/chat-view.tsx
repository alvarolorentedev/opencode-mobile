import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Alert, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, View } from 'react-native';
import { Button, Card, FAB, Snackbar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdates } from '@/providers/opencode-contexts';
import { ChatComposer } from '@/components/chat/chat-composer';
import { PendingPrompts } from '@/components/chat/pending-prompts';
import { ChatContent } from '@/components/chat/chat-content';
import { ChatHeader } from '@/components/chat/chat-header';
import { ChatLibrary } from '@/components/chat/chat-library';
import { styles } from '@/components/chat/chat-view-styles';
import { useChatViewController } from '@/components/chat/use-chat-view-controller';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { normalizeTranscriptFontSize } from '@/providers/opencode-preferences';

export function ChatView() {
  const { t } = useTranslation();
  const { block } = useUpdates();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const {
    activeProject, activeSession, approvals, attachments, availableAgents, awaitingUserInput,
    buildSendErrorDetails, changesVisible, chatPreferences, clearConversationFeedback,
    clearPromptError, commands, completedTodoCount, connection, contextModel, contextTokens,
    conversation, copiedMessageId, currentActivityLabel, currentDiffs, currentDiffScope,
    currentPendingPermissions, currentPendingQuestions, currentSessionId, currentTodos,
    currentUsage, diffAdditions, diffCount, diffDeletions, diffDetails, diffTurns,
    displayTranscript, draft, expandedDiffId, forkSession, handleAbort, handleAttach,
    handleConfirmStopConversation, handleCopyMessage, handleNewSession, handleReviewChanges,
    handleSendPrompt, handleSpeakEntry, handleToggleRecording, handleVoiceRecovery,
    isCreatingSession, isRefreshingDiffs, isRefreshingMessages, isSpeechInputAvailable,
    isSpeechInputListening, isStoppingSession, isUpdatingAutoApprove, latestAssistantTurnUsage,
    pendingPrompts, pendingInteractions, progressIcon, progressVisible, refreshCurrentSession, refreshDiffs,
    rejectQuestion, replyToPermission, replyToQuestion, revertSession, retryAttempt, running, selectDiffMessage,
    selectedAgentLabel, selectedDiffMessageId, selectedSession, sendErrorMessage,
    serverCapabilities, sessionMenuVisible, setAttachments, setAutoApprove, setChangesVisible,
    setCopiedMessageId, setDiffScope, setDraft, setExpandedDiffId, setIsUpdatingAutoApprove,
    setProgressVisible, setSendFeedback, setSessionMenuVisible, setVoiceFeedback, showSendAction,
    slim, speakingMessageId, toggleConversationMode, transcriptPaging, unrevertSession,
    updateChatPreferences, visibleModels, voiceFeedback, voiceRecoveryAction,
  } = useChatViewController();

  const progressAction = !awaitingUserInput && currentTodos.length > 0 ? (
    <FAB
      testID="chat-progress-button"
      size="small"
      icon={progressIcon}
      accessibilityLabel={t('chat:content.openProgressLabel', { completed: completedTodoCount, total: currentTodos.length })}
      onPress={() => setProgressVisible(true)}
      style={[styles.progressFab, diffCount > 0 && styles.progressFabInline, { backgroundColor: palette.surfaceAlt }]}
      color={palette.tint}
    />
  ) : null;

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: palette.background }]}
        behavior="padding">
        <ChatHeader
          activeProjectLabel={activeProject?.label}
          connectionStatus={connection.status}
          conversation={conversation}
          contextLimit={contextModel?.contextLimit}
          contextTokens={contextTokens}
          insetsTop={insets.top}
          isCreatingSession={isCreatingSession}
          onConfirmStopConversation={handleConfirmStopConversation}
          onCreateSession={() => void handleNewSession()}
          onOpenSessionMenu={() => setSessionMenuVisible(true)}
          palette={palette}
          selectedSession={selectedSession}
          latestAssistantTurnUsage={latestAssistantTurnUsage}
          slim={slim}
          usage={currentUsage}
        />

        <ChatContent
          activeSession={activeSession}
          progressAction={progressAction}
          progressVisible={progressVisible}
          onCloseProgress={() => setProgressVisible(false)}
          changesVisible={changesVisible && !awaitingUserInput}
          onCloseChanges={() => setChangesVisible(false)}
          currentSessionId={currentSessionId}
          awaitingUserInput={awaitingUserInput}
          connection={connection}
          copiedMessageId={copiedMessageId}
          currentActivityLabel={currentActivityLabel}
          currentDiffs={currentDiffs}
          currentDiffScope={currentDiffScope}
          currentPendingPermissions={currentPendingPermissions}
          currentPendingQuestions={currentPendingQuestions}
          currentTodos={currentTodos}
          diffCount={diffCount}
          diffDetails={diffDetails}
          diffTurns={diffTurns}
          displayTranscript={displayTranscript}
          flatTranscript={chatPreferences.flatTranscript === true}
          slim={slim}
          transcriptFontSize={normalizeTranscriptFontSize(chatPreferences.transcriptFontSize)}
          expandedDiffId={expandedDiffId}
          hasOlderMessages={transcriptPaging.hasOlder}
          isLoadingOlderMessages={transcriptPaging.isLoadingOlder}
          onLoadOlderMessages={() => {
            if (!currentSessionId || transcriptPaging.isLoadingOlder || !transcriptPaging.hasOlder) return;
            void transcriptPaging.loadOlder(currentSessionId);
          }}
          isRefreshingDiffs={isRefreshingDiffs}
          isRefreshingMessages={isRefreshingMessages}
          onCopyMessage={(entry) => void handleCopyMessage(entry)}
          onExpandDiff={setExpandedDiffId}
          onRefresh={() => void refreshCurrentSession()}
          onRefreshDiffs={() => void refreshDiffs()}
          onSelectDiffScope={setDiffScope}
          onSelectDiffMessage={selectDiffMessage}
          selectedDiffMessageId={selectedDiffMessageId}
          onRejectQuestion={(requestId) => rejectQuestion(requestId).catch((error) => { setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRejectQuestion')); throw error; })}
          onReplyToPermission={(requestId, reply) => replyToPermission(requestId, reply).catch((error) => { setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotReplyPermission')); })}
          onReplyToQuestion={(requestId, answers) => replyToQuestion(requestId, answers).catch((error) => { setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotAnswerQuestion')); throw error; })}
          onForkMessage={(messageId) => {
            if (!currentSessionId) return;
            void forkSession(currentSessionId, messageId).catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotFork')));
          }}
          onRevertMessage={(messageId) => {
            if (!currentSessionId) return;
            if (Platform.OS === 'web') {
              if (globalThis.confirm(t('chat:view.revertConfirm'))) {
                void revertSession(currentSessionId, messageId).catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRevert')));
              }
              return;
            }
            const release = block();
            Alert.alert(t('chat:view.revertTitle'), t('chat:view.revertMessage'), [
              { text: t('common:actions.cancel'), style: 'cancel', onPress: release },
              { text: t('chat:view.revert'), style: 'destructive', onPress: () => void revertSession(currentSessionId, messageId).catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRevert'))).finally(release) },
            ], { cancelable: true, onDismiss: release });
          }}
          onUnrevert={() => currentSessionId ? void unrevertSession(currentSessionId).catch((error) => setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotRestore'))) : undefined}
          onReviewChanges={handleReviewChanges}
          onSelectStarterPrompt={(prompt) => setDraft(prompt)}
          onToggleSpeak={(entry) => void handleSpeakEntry(entry)}
          palette={palette}
          pendingInteractions={pendingInteractions}
          retryAttempt={retryAttempt}
          running={running}
          speakingMessageId={speakingMessageId}
        />

        {sendErrorMessage ? (
          <Card mode="contained" style={[styles.sendErrorCard, { backgroundColor: `${palette.danger}14` }]}>
            <Card.Content style={styles.sendErrorContent}>
              <Text variant="titleSmall" style={{ color: palette.danger }}>{t('chat:view.actionFailed')}</Text>
              <Text selectable variant="bodySmall" style={{ color: palette.text }}>{sendErrorMessage}</Text>
              <View style={styles.sendErrorActions}>
                <Button compact onPress={() => {
                  void Clipboard.setStringAsync(buildSendErrorDetails()).then(() => setCopiedMessageId('__send-error__'));
                }}>{t('chat:view.copyDetails')}</Button>
                <Button compact onPress={() => {
                  setSendFeedback(undefined);
                  clearPromptError();
                }}>{t('common:actions.dismiss')}</Button>
              </View>
            </Card.Content>
          </Card>
        ) : null}

        {approvals.mcpAuth ? (
          <Card mode="contained" style={[styles.sendErrorCard, { backgroundColor: `${palette.warning}14` }]}>
            <Card.Content style={styles.sendErrorContent}>
              <Text variant="titleSmall" style={{ color: palette.warning }}>{t('chat:approvals.mcpAuthTitle')}</Text>
              <Text selectable variant="bodySmall" style={{ color: palette.text }}>{t('chat:approvals.mcpAuthNeeded', { name: approvals.mcpAuth.mcpName })}</Text>
              <View style={styles.sendErrorActions}>
                <Button compact icon="open-in-new" onPress={() => {
                  const url = approvals.mcpAuth?.url;
                  if (url) {
                    void Linking.openURL(url).catch(() => undefined);
                  }
                }}>{t('chat:approvals.openAuthLink')}</Button>
                <Button compact onPress={approvals.dismissMcpAuth}>{t('common:actions.dismiss')}</Button>
              </View>
            </Card.Content>
          </Card>
        ) : null}

        {diffCount > 0 ? (
          <View style={styles.changesChipRow}>
            {progressAction ? <View style={styles.progressSpacer} /> : null}
            <View style={styles.changesChipCenter}>
              <Pressable
                testID="chat-changes-chip"
                accessibilityRole="button"
                accessibilityLabel={`${t('chat:cards.reviewChanges')}. ${currentDiffs.length > 0
                  ? t('chat:diff.filesChangedCompact', { files: diffCount, count: diffCount, additions: diffAdditions, deletions: diffDeletions })
                  : t('chat:diff.filesChangedSimple', { files: diffCount, count: diffCount })}`}
                onPress={() => { Keyboard.dismiss(); setChangesVisible(true); }}
                style={({ pressed }) => [styles.changesChip, { backgroundColor: palette.surfaceAlt, opacity: pressed ? 0.75 : 1 }]}>
                <Text variant="labelLarge" style={{ color: palette.text }}>{t('chat:diff.filesChangedSimple', { files: diffCount, count: diffCount })}</Text>
                {currentDiffs.length > 0 ? <>
                  <Text variant="labelLarge" style={{ color: palette.success }}>+{diffAdditions}</Text>
                  <Text variant="labelLarge" style={{ color: palette.danger }}>−{diffDeletions}</Text>
                </> : null}
              </Pressable>
            </View>
            {progressAction}
          </View>
        ) : null}

        <PendingPrompts key={currentSessionId} prompts={pendingPrompts} />
        <ChatComposer
          key={`${currentSessionId}:${currentPendingPermissions.map((item) => item.id).join()}:${currentPendingQuestions.map((item) => item.id).join()}`}
          attachments={attachments}
          autoApproveAvailable={serverCapabilities.configWrite}
          availableAgents={availableAgents}
          chatPreferences={chatPreferences}
          connectionStatus={connection.status}
          conversation={conversation}
          currentSessionId={currentSessionId}
          commands={commands}
          draft={draft}
          isCreatingSession={isCreatingSession}
          isSpeechInputAvailable={isSpeechInputAvailable}
          isSpeechInputListening={isSpeechInputListening}
          isStoppingSession={isStoppingSession}
          isUpdatingAutoApprove={isUpdatingAutoApprove}
          onToggleConversationMode={() => void toggleConversationMode()}
          onAttach={() => void handleAttach()}
          onDraftChange={(value) => {
            setSendFeedback(undefined);
            setDraft(value);
          }}
          onCommandSelect={(command) => setDraft(`/${command} `)}
          onRemoveAttachment={(index) => {
            setSendFeedback(undefined);
            setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
          }}
          onSend={() => {
            if (!showSendAction) {
              void handleAbort();
              return;
            }

            void handleSendPrompt();
          }}
          onToggleAutoApprove={async () => {
            setSendFeedback(undefined);
            setIsUpdatingAutoApprove(true);
            try {
              await setAutoApprove(!chatPreferences.autoApprove);
              return true;
            } catch (error) {
              setSendFeedback(error instanceof Error ? error.message : t('chat:view.couldNotUpdateAutoApprove'));
              return false;
            } finally {
              setIsUpdatingAutoApprove(false);
            }
          }}
          onToggleRecording={() => void handleToggleRecording()}
          palette={palette}
          selectedAgentLabel={selectedAgentLabel}
          showSendAction={showSendAction}
          slim={slim}
          updateChatPreferences={updateChatPreferences}
          visibleModels={visibleModels}
        />
      </KeyboardAvoidingView>

      <ChatLibrary visible={sessionMenuVisible} onClose={() => setSessionMenuVisible(false)} />

      <Snackbar visible={Boolean(copiedMessageId)} onDismiss={() => setCopiedMessageId(undefined)} duration={1800}>
        {copiedMessageId === '__send-error__' ? t('chat:view.errorDetailsCopied') : t('chat:view.messageCopied')}
      </Snackbar>
      <Snackbar
        visible={Boolean(conversation.feedback || voiceFeedback)}
        onDismiss={() => {
          setSendFeedback(undefined);
          setVoiceFeedback(undefined);
          clearConversationFeedback();
        }}
        duration={voiceRecoveryAction === 'none' ? 3200 : 6000}
        action={voiceRecoveryAction === 'none' ? undefined : {
          label: voiceRecoveryAction === 'open-settings' ? t('common:actions.openSettings') : t('common:actions.retry'),
          onPress: handleVoiceRecovery,
        }}>
        {conversation.feedback || voiceFeedback}
      </Snackbar>
    </>
  );
}
