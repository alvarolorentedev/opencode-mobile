import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Button, Card, Snackbar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatContent } from '@/components/chat/chat-content';
import { ChatHeader } from '@/components/chat/chat-header';
import { TopTab } from '@/components/chat/chat-controls';
import { styles } from '@/components/chat/chat-view-styles';
import { TRANSCRIPT_PAGE_SIZE } from '@/components/chat/chat-view-utils';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { type TranscriptEntry } from '@/lib/opencode/format';
import { getTranscriptActivityLabel, isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import { useOpencode } from '@/providers/opencode-provider';

export function ChatView() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const isPaginatingRef = useRef(false);
  const {
    activeSession,
    availableAgents,
    availableModels,
    chatPreferences,
    commands,
    connection,
    configuredProviders,
    createSession,
    conversation,
    clearConversationFeedback,
    clearPromptError,
    currentDiffs,
    currentPendingPermissions,
    currentPendingQuestions,
    currentTodos,
    currentSessionId,
    currentTranscript,
    ensureActiveSession,
    isRefreshingDiffs,
    isRefreshingMessages,
    openSession,
    refreshCurrentSession,
    replyToPermission,
    replyToQuestion,
    rejectQuestion,
    executeCommand,
    forkSession,
    revertSession,
    unrevertSession,
    sendPrompt,
    promptError,
    sendingState,
    settings,
    sessionStatuses,
    sessions,
    setAutoApprove,
    toggleConversationMode,
    updateChatPreferences,
    abortSession,
  } = useOpencode();

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<{ uri: string; mime?: string; filename?: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'session' | 'changes'>('session');
  const [sessionMenuVisible, setSessionMenuVisible] = useState(false);
  const [isUpdatingAutoApprove, setIsUpdatingAutoApprove] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [visibleTranscriptCount, setVisibleTranscriptCount] = useState(TRANSCRIPT_PAGE_SIZE);
  const [expandedDiffId, setExpandedDiffId] = useState<string | undefined>();
  const [copiedMessageId, setCopiedMessageId] = useState<string | undefined>();
  const [speakingMessageId, setSpeakingMessageId] = useState<string | undefined>(undefined);
  const [voiceFeedback, setVoiceFeedback] = useState<string | undefined>(undefined);
  const [sendFeedback, setSendFeedback] = useState<string | undefined>(undefined);
  const speechDraftPrefixRef = useRef('');
  const draftRef = useRef('');
  const attachmentsRef = useRef<{ uri: string; mime?: string; filename?: string }[]>([]);
  const lastSentAttachmentsRef = useRef<{ uri: string; mime?: string; filename?: string }[]>([]);
  const lastAutoSpokenMessageIdRef = useRef<string | undefined>(undefined);

  const status = currentSessionId ? sessionStatuses[currentSessionId] : undefined;
  const running = sendingState.active || (!!status && status.type !== 'idle');
  const conversationActive = conversation.active;
  const hasDraftInput = !!draft.trim() || attachments.length > 0;
  const showSendAction = !running || hasDraftInput;
  const visibleModels = useMemo(() => {
    const configuredProviderIds = new Set(configuredProviders.map((provider) => provider.id));
    const enabledModelIds = new Set(chatPreferences.enabledModelIds);

    return availableModels.filter((model) => configuredProviderIds.has(model.providerID) && (enabledModelIds.size === 0 || enabledModelIds.has(model.id)));
  }, [availableModels, chatPreferences.enabledModelIds, configuredProviders]);
  const diffDetails = useMemo(
    () => currentTranscript.flatMap((entry) => entry.details.filter((detail) => detail.kind === 'patch')),
    [currentTranscript],
  );
  const diffCount = currentDiffs.length || new Set(diffDetails.flatMap((detail) => detail.body.split('\n').filter(Boolean))).size;
  const selectedAgentLabel = useMemo(
    () => availableAgents.find((agent) => agent.id === chatPreferences.mode)?.label || chatPreferences.mode,
    [availableAgents, chatPreferences.mode],
  );
  const pendingInteractions = currentPendingPermissions.length + currentPendingQuestions.length;
  const awaitingUserInput = pendingInteractions > 0;
  const displayTranscript = useMemo(() => currentTranscript.filter(isTranscriptDisplayMessage), [currentTranscript]);
  const visibleTranscript = useMemo(
    () => displayTranscript.slice(Math.max(0, displayTranscript.length - visibleTranscriptCount)),
    [displayTranscript, visibleTranscriptCount],
  );
  const hasMoreTranscript = visibleTranscript.length < displayTranscript.length;
  const currentActivityLabel = useMemo(() => {
    for (let index = currentTranscript.length - 1; index >= 0; index -= 1) {
      const entry = currentTranscript[index];
      if (isTranscriptDisplayMessage(entry)) {
        continue;
      }

      const label = getTranscriptActivityLabel(entry);
      if (label) {
        return label;
      }
    }

    return undefined;
  }, [currentTranscript]);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) || activeSession,
    [activeSession, currentSessionId, sessions],
  );
  const visiblePromptError = promptError && (!promptError.sessionId || promptError.sessionId === currentSessionId)
    ? promptError.message
    : undefined;
  const sendErrorMessage = sendFeedback || visiblePromptError;
  const sendErrorDetails = sendErrorMessage
    ? [
        'OpenCode send failed',
        `Error: ${sendErrorMessage}`,
        `Time: ${new Date(promptError?.occurredAt || Date.now()).toISOString()}`,
        `Session: ${currentSessionId || 'unknown'}`,
        `Server: ${settings.serverUrl}`,
        `Model: ${chatPreferences.modelId || 'unknown'}`,
        `Attachments: ${lastSentAttachmentsRef.current.map((attachment) => attachment.filename || attachment.mime || 'unnamed').join(', ') || 'none'}`,
      ].join('\n')
    : '';
  const visibleSessions = sessions;

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const latestAssistantEntry = useMemo(
    () => [...displayTranscript].reverse().find((entry) => entry.role === 'assistant' && entry.text.trim()),
    [displayTranscript],
  );
  const speechInput = useSpeechInput({
    locale: chatPreferences.speechLocale,
    onResult: (transcript) => {
      setDraft(`${speechDraftPrefixRef.current}${transcript}`);
    },
    preferOnDevice: chatPreferences.preferOnDeviceRecognition,
  });
  const {
    error: speechInputError,
    isAvailable: isSpeechInputAvailable,
    isListening: isSpeechInputListening,
    start: startSpeechInput,
    stop: stopSpeechInput,
  } = speechInput;

  const handleSendPrompt = useCallback(async (promptOverride?: string) => {
    const nextDraft = promptOverride ?? draftRef.current;
    const nextAttachments = attachmentsRef.current;
    const prompt = nextDraft.trim();
    if ((!prompt && nextAttachments.length === 0) || connection.status !== 'connected') {
      return;
    }

    try {
      setSendFeedback(undefined);
      lastSentAttachmentsRef.current = nextAttachments;
      const sessionId = currentSessionId || (await ensureActiveSession());
      if (!sessionId) {
        return;
      }

      setDraft('');
      setAttachments([]);

      const commandMatch = nextAttachments.length === 0 ? prompt.match(/^\/(\S+)(?:\s+([\s\S]*))?$/) : undefined;
      if (commandMatch && commands.some((command) => command.name === commandMatch[1])) {
        await executeCommand(sessionId, commandMatch[1], commandMatch[2] || '');
        return;
      }

      const sent = await sendPrompt(sessionId, prompt, nextAttachments);
      if (!sent) {
        setDraft(nextDraft);
        setAttachments(nextAttachments);
        setSendFeedback('OpenCode could not send that message. Try again in a moment.');
      }
    } catch (error) {
      setDraft(nextDraft);
      setAttachments(nextAttachments);
      setSendFeedback(error instanceof Error ? error.message : 'OpenCode could not send that message.');
    }
  }, [commands, connection.status, currentSessionId, ensureActiveSession, executeCommand, sendPrompt]);

  useEffect(() => {
    setVisibleTranscriptCount(TRANSCRIPT_PAGE_SIZE);
  }, [currentSessionId]);

  useEffect(() => {
    if (displayTranscript.length <= visibleTranscriptCount) {
      return;
    }

    const latestVisibleId = visibleTranscript[0]?.id;
    const nextWindow = displayTranscript.slice(Math.max(0, displayTranscript.length - visibleTranscriptCount));
    if (latestVisibleId && !nextWindow.some((entry) => entry.id === latestVisibleId)) {
      setVisibleTranscriptCount((current) => current + TRANSCRIPT_PAGE_SIZE);
    }
  }, [displayTranscript, visibleTranscript, visibleTranscriptCount]);

  useEffect(() => {
    if (isPaginatingRef.current) {
      isPaginatingRef.current = false;
      return;
    }

    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: visibleTranscript.length > 1 });
    }, 80);

    return () => clearTimeout(timer);
  }, [activeTab, pendingInteractions, running, visibleTranscript]);

  useEffect(() => {
    if (pendingInteractions > 0) {
      setActiveTab('session');
    }
  }, [pendingInteractions]);

  useEffect(() => {
    if (!copiedMessageId) {
      return;
    }

    const timer = setTimeout(() => setCopiedMessageId(undefined), 1800);
    return () => clearTimeout(timer);
  }, [copiedMessageId]);

  useEffect(() => {
    if (!speechInputError) {
      return;
    }

    setVoiceFeedback(speechInputError);
  }, [speechInputError]);

  useEffect(
    () => () => {
      void stopSpeaking().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (running || conversationActive || !chatPreferences.autoPlayAssistantReplies) {
      return;
    }

    if (!latestAssistantEntry || latestAssistantEntry.id === lastAutoSpokenMessageIdRef.current) {
      return;
    }

    void (async () => {
      const started = await speakText({
        language: chatPreferences.speechLocale,
        onDone: () => setSpeakingMessageId((current) => (current === latestAssistantEntry.id ? undefined : current)),
        onError: () => {
          setVoiceFeedback('Unable to play this assistant reply.');
          setSpeakingMessageId(undefined);
        },
        onStart: () => setSpeakingMessageId(latestAssistantEntry.id),
        rate: chatPreferences.speechRate,
        text: latestAssistantEntry.text,
        voice: chatPreferences.speechVoiceId,
      });

      if (started) {
        lastAutoSpokenMessageIdRef.current = latestAssistantEntry.id;
      }
    })();
  }, [chatPreferences.autoPlayAssistantReplies, chatPreferences.speechLocale, chatPreferences.speechRate, chatPreferences.speechVoiceId, conversationActive, latestAssistantEntry, running]);

  async function handleCopyMessage(entry: TranscriptEntry) {
    const value = [entry.text.trim(), entry.error?.trim()].filter(Boolean).join('\n\n');
    if (!value) {
      return;
    }

    await Clipboard.setStringAsync(value);
    setCopiedMessageId(entry.id);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }

  function handleLoadEarlier() {
    isPaginatingRef.current = true;
    setVisibleTranscriptCount((current) => current + TRANSCRIPT_PAGE_SIZE);
  }

  async function handleToggleRecording() {
    if (conversationActive) {
      return;
    }

    if (isSpeechInputListening) {
      stopSpeechInput();
      return;
    }

    speechDraftPrefixRef.current = draft.trim() ? `${draft.trim()} ` : '';
    const started = await startSpeechInput();
    if (!started) {
      return;
    }

    void Haptics.selectionAsync().catch(() => undefined);
  }

  async function handleSpeakEntry(entry: TranscriptEntry) {
    if (speakingMessageId === entry.id) {
      await stopSpeaking().catch(() => undefined);
      setSpeakingMessageId(undefined);
      return;
    }

    if (conversationActive) {
      setVoiceFeedback('Stop conversation mode before playing a reply manually.');
      return;
    }

    const started = await speakText({
      language: chatPreferences.speechLocale,
      onDone: () => {
        setSpeakingMessageId((current) => (current === entry.id ? undefined : current));
      },
      onError: () => {
        setVoiceFeedback('Unable to play this assistant reply.');
        setSpeakingMessageId(undefined);
      },
      onStart: () => setSpeakingMessageId(entry.id),
      rate: chatPreferences.speechRate,
      text: entry.text,
      voice: chatPreferences.speechVoiceId,
    });

    if (!started) {
      setVoiceFeedback('There is no readable text in this assistant reply.');
    }
  }

  async function handleAttach() {
    try {
      const picker = await import('expo-document-picker');
      const result = await picker.getDocumentAsync({
        base64: Platform.OS === 'web',
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }
      if (result.assets.some((asset) => typeof asset.size === 'number' && asset.size > 10 * 1024 * 1024)) {
        setSendFeedback('File exceeds the 10 MB attachment limit.');
        return;
      }

      setSendFeedback(undefined);
      setAttachments((current) => {
        const next = [...current];

        result.assets.forEach((asset) => {
          const uri = asset.base64 || asset.uri;
          if (!next.some((attachment) => attachment.uri === uri)) {
            next.push({
              uri,
              mime: asset.mimeType || 'application/octet-stream',
              filename: asset.name,
            });
          }
        });

        return next;
      });
    } catch (error) {
      setSendFeedback(error instanceof Error ? error.message : 'Could not attach that file.');
    }
  }

  async function handleNewSession() {
    setIsCreatingSession(true);
    try {
      const session = await createSession();
      await openSession(session.id);
      setActiveTab('session');
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function handleAbort() {
    if (!currentSessionId) {
      return;
    }

    setIsStoppingSession(true);
    try {
      await abortSession(currentSessionId);
    } finally {
      setIsStoppingSession(false);
    }
  }

  function handleConfirmStopConversation() {
    Alert.alert('Stop conversation?', 'This will stop conversation mode and OpenCode will stop listening for your next turn.', [
      { style: 'cancel', text: 'Keep going' },
      {
        style: 'destructive',
        text: 'Stop',
        onPress: () => {
          void toggleConversationMode();
        },
      },
    ]);
  }

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: palette.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
        <ChatHeader
          connectionStatus={connection.status}
          conversation={conversation}
          currentSessionId={currentSessionId}
          insetsTop={insets.top}
          isCreatingSession={isCreatingSession}
          onCloseMenu={() => setSessionMenuVisible(false)}
          onConfirmStopConversation={handleConfirmStopConversation}
          onCreateSession={() => void handleNewSession()}
          onOpenSession={(sessionId) => {
            setSessionMenuVisible(false);
            void openSession(sessionId);
          }}
          onOpenSessionMenu={() => setSessionMenuVisible(true)}
          onToggleConversationMode={() => void toggleConversationMode()}
          palette={palette}
          selectedSession={selectedSession}
          sessionMenuVisible={sessionMenuVisible}
          sessions={visibleSessions}
        />

        <View style={[styles.tabsRow, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
          <TopTab active={activeTab === 'session'} label="Session" onPress={() => setActiveTab('session')} />
          <TopTab active={activeTab === 'changes'} label={`${diffCount} Files Changed`} onPress={() => setActiveTab('changes')} />
        </View>

        <ChatContent
          activeSession={activeSession}
          activeTab={activeTab}
          awaitingUserInput={awaitingUserInput}
          connection={connection}
          copiedMessageId={copiedMessageId}
          currentActivityLabel={currentActivityLabel}
          currentDiffs={currentDiffs}
          currentPendingPermissions={currentPendingPermissions}
          currentPendingQuestions={currentPendingQuestions}
          currentTodos={currentTodos}
          diffCount={diffCount}
          diffDetails={diffDetails}
          displayTranscript={displayTranscript}
          expandedDiffId={expandedDiffId}
          hasMoreTranscript={hasMoreTranscript}
          isRefreshingDiffs={isRefreshingDiffs}
          isRefreshingMessages={isRefreshingMessages}
          onCopyMessage={(entry) => void handleCopyMessage(entry)}
          onExpandDiff={setExpandedDiffId}
          onLoadEarlier={handleLoadEarlier}
          onRefresh={() => void refreshCurrentSession()}
          onRejectQuestion={(requestId) => void rejectQuestion(requestId)}
          onReplyToPermission={(requestId, reply) => void replyToPermission(requestId, reply)}
          onReplyToQuestion={(requestId, answers) => void replyToQuestion(requestId, answers)}
          onForkMessage={(messageId) => {
            if (!currentSessionId) return;
            void forkSession(currentSessionId, messageId).catch((error) => setSendFeedback(error instanceof Error ? error.message : 'Could not fork session.'));
          }}
          onRevertMessage={(messageId) => {
            if (!currentSessionId) return;
            if (Platform.OS === 'web') {
              if (globalThis.confirm('Revert from this message?\n\nOpenCode will revert session changes after this point.')) {
                void revertSession(currentSessionId, messageId).catch((error) => setSendFeedback(error instanceof Error ? error.message : 'Could not revert session.'));
              }
              return;
            }
            Alert.alert('Revert from this message?', 'OpenCode will revert session changes after this point.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Revert', style: 'destructive', onPress: () => void revertSession(currentSessionId, messageId).catch((error) => setSendFeedback(error instanceof Error ? error.message : 'Could not revert session.')) },
            ]);
          }}
          onUnrevert={() => currentSessionId ? void unrevertSession(currentSessionId) : undefined}
          onSendStarterPrompt={(prompt) => void handleSendPrompt(prompt)}
          onToggleSpeak={(entry) => void handleSpeakEntry(entry)}
          palette={palette}
          pendingInteractions={pendingInteractions}
          running={running}
          scrollRef={scrollRef}
          speakingMessageId={speakingMessageId}
          status={status}
          visibleTranscript={visibleTranscript}
        />

        {sendErrorMessage ? (
          <Card mode="contained" style={[styles.sendErrorCard, { backgroundColor: `${palette.danger}14` }]}>
            <Card.Content style={styles.sendErrorContent}>
              <Text variant="titleSmall" style={{ color: palette.danger }}>Message not sent</Text>
              <Text selectable variant="bodySmall" style={{ color: palette.text }}>{sendErrorMessage}</Text>
              <View style={styles.sendErrorActions}>
                <Button compact onPress={() => {
                  void Clipboard.setStringAsync(sendErrorDetails).then(() => setCopiedMessageId('__send-error__'));
                }}>Copy details</Button>
                <Button compact onPress={() => {
                  setSendFeedback(undefined);
                  clearPromptError();
                }}>Dismiss</Button>
              </View>
            </Card.Content>
          </Card>
        ) : null}

        <ChatComposer
          attachments={attachments}
          availableAgents={availableAgents}
          chatPreferences={chatPreferences}
          connectionStatus={connection.status}
          conversation={conversation}
          currentSessionId={currentSessionId}
          commands={commands}
          draft={draft}
          insetsBottom={insets.bottom}
          isCreatingSession={isCreatingSession}
          isSpeechInputAvailable={isSpeechInputAvailable}
          isSpeechInputListening={isSpeechInputListening}
          isStoppingSession={isStoppingSession}
          isUpdatingAutoApprove={isUpdatingAutoApprove}
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
          onToggleAutoApprove={() => {
            setIsUpdatingAutoApprove(true);
            void setAutoApprove(!chatPreferences.autoApprove).finally(() => setIsUpdatingAutoApprove(false));
          }}
          onToggleRecording={() => void handleToggleRecording()}
          palette={palette}
          selectedAgentLabel={selectedAgentLabel}
          showSendAction={showSendAction}
          updateChatPreferences={updateChatPreferences}
          visibleModels={visibleModels}
        />
      </KeyboardAvoidingView>

      <Snackbar visible={Boolean(copiedMessageId)} onDismiss={() => setCopiedMessageId(undefined)} duration={1800}>
        {copiedMessageId === '__send-error__' ? 'Error details copied' : 'Message copied to clipboard'}
      </Snackbar>
      <Snackbar
        visible={Boolean(conversation.feedback || voiceFeedback)}
        onDismiss={() => {
          setSendFeedback(undefined);
          setVoiceFeedback(undefined);
          clearConversationFeedback();
        }}
        duration={3200}>
        {conversation.feedback || voiceFeedback}
      </Snackbar>
    </>
  );
}
