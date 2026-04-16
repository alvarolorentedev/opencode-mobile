import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Appbar,
  Button,
  Card,
  Chip,
  IconButton,
  List,
  Menu,
  Portal,
  Snackbar,
  Surface,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
import { PendingInteractionsCard, DiffCard, SessionDiffCard, TranscriptMessage } from '@/components/chat/chat-cards';
import { MenuControl, ControlButton, TopTab } from '@/components/chat/chat-controls';
import { ConversationOverlay } from '@/components/chat/chat-overlay';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getSessionSubtitle, type TranscriptEntry } from '@/lib/opencode/format';
import { getTranscriptActivityLabel, isTranscriptDisplayMessage } from '@/lib/opencode/transcript';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import {
  type ModelOption,
  type ReasoningLevel,
  useOpencode,
} from '@/providers/opencode-provider';

const STARTER_PROMPTS = [
  'Polish this mobile UI to feel closer to OpenCode web mode.',
  'Review the current workspace and suggest the next highest-impact fix.',
  'Implement the feature request and keep me updated as you work.',
];

const REASONING_OPTIONS: { id: ReasoningLevel; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'default', label: 'Default' },
  { id: 'high', label: 'High' },
];

const TRANSCRIPT_PAGE_SIZE = 20;

function getModelLabel(models: ModelOption[], modelId?: string) {
  const match = models.find((model) => model.id === modelId);
  return match ? match.label : 'Select model';
}

function getAutoApproveIcon(autoApprove: boolean) {
  return autoApprove ? 'shield-check' : 'shield-key';
}

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
    connection,
    configuredProviders,
    createSession,
    conversation,
    clearConversationFeedback,
    currentDiffs,
    currentPendingPermissions,
    currentPendingQuestions,
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
    sendPrompt,
    sendingState,
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
  const [menu, setMenu] = useState<'mode' | 'model' | 'reasoning' | 'session' | undefined>();
  const [isUpdatingAutoApprove, setIsUpdatingAutoApprove] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [visibleTranscriptCount, setVisibleTranscriptCount] = useState(TRANSCRIPT_PAGE_SIZE);
  const [expandedDiffId, setExpandedDiffId] = useState<string | undefined>();
  const [copiedMessageId, setCopiedMessageId] = useState<string | undefined>();
  const [speakingMessageId, setSpeakingMessageId] = useState<string | undefined>(undefined);
  const [voiceFeedback, setVoiceFeedback] = useState<string | undefined>(undefined);
  const speechDraftPrefixRef = useRef('');
  const draftRef = useRef('');
  const attachmentsRef = useRef<{ uri: string; mime?: string; filename?: string }[]>([]);
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
    () => currentTranscript.flatMap((entry) => entry.details.filter((detail) => detail.kind === 'patch' || detail.kind === 'file')),
    [currentTranscript],
  );
  const selectedAgentLabel = useMemo(
    () => availableAgents.find((agent) => agent.id === chatPreferences.mode)?.label || chatPreferences.mode,
    [availableAgents, chatPreferences.mode],
  );
  const pendingInteractions = currentPendingPermissions.length + currentPendingQuestions.length;
  const awaitingUserInput = pendingInteractions > 0;
  const displayTranscript = useMemo(
    () => currentTranscript.filter(isTranscriptDisplayMessage),
    [currentTranscript],
  );
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
  const visibleSessions = useMemo(
    () => sessions.filter((session) => !session?.time?.archived),
    [sessions],
  );

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
  const latestUserEntry = useMemo(
    () => [...displayTranscript].reverse().find((entry) => entry.role === 'user' && entry.text.trim()),
    [displayTranscript],
  );
  const speechInput = useSpeechInput({
    locale: chatPreferences.speechLocale,
    onResult: (transcript, isFinal) => {
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
      const sessionId = currentSessionId || (await ensureActiveSession());
      if (!sessionId) {
        return;
      }

      setDraft('');
      setAttachments([]);

      const sent = await sendPrompt(sessionId, prompt, nextAttachments);
      if (!sent) {
        setDraft(nextDraft);
        setAttachments(nextAttachments);
        return;
      }
    } catch (error) {
      setDraft(nextDraft);
      setAttachments(nextAttachments);
      throw error;
    }
  }, [connection.status, currentSessionId, ensureActiveSession, sendPrompt]);

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

    const started = speakText({
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

    const started = speakText({
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
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      setAttachments((current) => {
        const next = [...current];

        result.assets.forEach((asset) => {
          if (!next.some((attachment) => attachment.uri === asset.uri)) {
            next.push({
              uri: asset.uri,
              mime: asset.mimeType || 'application/octet-stream',
              filename: asset.name,
            });
          }
        });

        return next;
      });
    } catch (error) {
      console.warn('Attachment picker error', error);
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

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: palette.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
      <Appbar.Header
        style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }]}
        statusBarHeight={0}
        elevated>
        <View style={styles.headerMain}>
          <TouchableRipple borderless onPress={() => setMenu('session')} style={styles.headerSessionAnchor}>
            <View style={styles.headerSessionContent}>
              <View style={styles.headerSessionTextWrap}>
                <Text numberOfLines={1} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}>
                  {selectedSession?.title || 'Untitled chat'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
            </View>
          </TouchableRipple>
        </View>
        <View style={styles.headerActions}>
          <Appbar.Action icon="plus" onPress={() => void handleNewSession()} disabled={isCreatingSession || connection.status !== 'connected'} />
          <Appbar.Action
            icon={conversationActive ? 'phone-hangup' : 'headset'}
            onPress={() => void toggleConversationMode()}
            disabled={connection.status !== 'connected' || isCreatingSession}
          />
        </View>
      </Appbar.Header>
      <Portal>
        {menu === 'session' ? (
          <View style={styles.sessionPickerOverlay}>
            <TouchableRipple borderless onPress={() => setMenu(undefined)} style={styles.sessionPickerBackdrop}>
              <View style={styles.sessionPickerBackdropFill} />
            </TouchableRipple>
            <Surface
              style={[
                styles.sessionPickerSheet,
                {
                  top: 64 + insets.top,
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
              elevation={4}>
              <View style={[styles.sessionPickerHeader, { borderBottomColor: palette.border }]}> 
                <Text variant="titleMedium" style={{ color: palette.text }}>Chats</Text>
                <Button compact onPress={() => setMenu(undefined)}>Close</Button>
              </View>
              <ScrollView contentContainerStyle={styles.sessionPickerList} keyboardShouldPersistTaps="handled">
                {visibleSessions.length === 0 ? (
                  <Text variant="bodyMedium" style={{ color: palette.muted }}>No chats yet.</Text>
                ) : null}
                {visibleSessions.map((session) => {
                  const isSelected = session.id === currentSessionId;

                  return (
                    <List.Item
                      key={session.id}
                      title={session.title || 'Untitled chat'}
                      description={getSessionSubtitle(session)}
                      titleStyle={{ color: palette.text, fontWeight: isSelected ? '700' : '500' }}
                      descriptionStyle={{ color: palette.muted }}
                      left={() => (isSelected ? <List.Icon icon="check-circle" color={palette.tint} /> : <List.Icon icon="message-outline" color={palette.muted} />)}
                      onPress={() => {
                        setMenu(undefined);
                        void openSession(session.id);
                      }}
                      style={[styles.sessionPickerItem, { backgroundColor: isSelected ? palette.background : 'transparent', borderColor: palette.border }]}
                    />
                  );
                })}
              </ScrollView>
            </Surface>
          </View>
        ) : null}
        {conversationActive ? (
          <ConversationOverlay
            currentActivityLabel={currentActivityLabel}
            insetsTop={insets.top}
            latestAssistantText={latestAssistantEntry?.text}
            latestUserText={latestUserEntry?.text}
            onStop={() => void toggleConversationMode()}
            phase={conversation.phase}
            sessionTitle={selectedSession?.title || 'Untitled chat'}
            statusLabel={conversation.statusLabel}
          />
        ) : null}
      </Portal>

      <View style={[styles.tabsRow, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}> 
        <TopTab active={activeTab === 'session'} label="Session" onPress={() => setActiveTab('session')} />
        <TopTab
          active={activeTab === 'changes'}
          label={`${currentDiffs.length || diffDetails.length || 0} Files Changed`}
          onPress={() => setActiveTab('changes')}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshingMessages || isRefreshingDiffs}
            onRefresh={() => void refreshCurrentSession()}
            tintColor={palette.tint}
          />
        }>
        {connection.status === 'error' ? (
          <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}> 
            <Card.Content>
              <Text variant="titleMedium" style={{ color: palette.text }}>Connection issue</Text>
              <Text variant="bodyMedium" style={{ color: palette.muted }}>{connection.message}</Text>
            </Card.Content>
          </Card>
        ) : null}

        {activeTab === 'session' && displayTranscript.length === 0 ? (
          <Card mode="contained" style={[styles.emptyCard, { backgroundColor: palette.surface }]}> 
            <Card.Content style={styles.emptyContent}>
              <Text variant="headlineSmall" style={[styles.emptyTitle, { color: palette.text }]}>Start a new task</Text>
              <Text variant="bodyMedium" style={{ color: palette.muted }}>
                Keep the prompt specific and OpenCode will inspect the workspace, show progress, and stream back file changes.
              </Text>
              <View style={styles.promptStack}>
                {STARTER_PROMPTS.map((prompt) => (
                  <TouchableRipple
                    key={prompt}
                    style={[styles.promptCard, { borderColor: palette.border, backgroundColor: palette.background }]}
                    onPress={() => void handleSendPrompt(prompt)}>
                    <View style={styles.promptCardInner}>
                      <MaterialCommunityIcons name="lightning-bolt" size={18} color={palette.tint} />
                      <Text variant="bodyMedium" style={{ color: palette.text }}>{prompt}</Text>
                    </View>
                  </TouchableRipple>
                ))}
              </View>
            </Card.Content>
          </Card>
        ) : null}

        {activeTab === 'session' && hasMoreTranscript ? (
          <View style={styles.paginationRow}>
            <Button mode="text" onPress={handleLoadEarlier}>
              Load earlier messages
            </Button>
          </View>
        ) : null}

        {activeTab === 'session'
          ? visibleTranscript.map((entry) => (
              <TranscriptMessage
                key={entry.id}
                canSpeak={entry.role === 'assistant' && Boolean(entry.text.trim())}
                copied={copiedMessageId === entry.id}
                entry={entry}
                onCopy={() => void handleCopyMessage(entry)}
                onToggleSpeak={() => void handleSpeakEntry(entry)}
                speaking={speakingMessageId === entry.id}
              />
            ))
          : null}

        {activeTab === 'session' && pendingInteractions > 0 ? (
          <PendingInteractionsCard
            permissions={currentPendingPermissions}
            questions={currentPendingQuestions}
            onPermissionReply={(requestId, reply) => void replyToPermission(requestId, reply)}
            onQuestionReject={(requestId) => void rejectQuestion(requestId)}
            onQuestionSubmit={(requestId, answers) => void replyToQuestion(requestId, answers)}
          />
        ) : null}

        {activeTab === 'changes' ? (
          <View style={styles.sectionStack}>
            <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}> 
              <Card.Content style={styles.sectionHeaderCard}>
                <View>
                  <Text variant="titleMedium" style={{ color: palette.text }}>Workspace diff</Text>
                  <Text variant="bodyMedium" style={{ color: palette.muted }}>
                    {activeSession ? getSessionSubtitle(activeSession) : 'Current session'}
                  </Text>
                </View>
                <Text variant="labelMedium" style={{ color: palette.tint }}>{isRefreshingDiffs ? 'Syncing' : status?.type || 'idle'}</Text>
              </Card.Content>
            </Card>

            {currentDiffs.length === 0 && diffDetails.length === 0 ? (
              <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}> 
                <Card.Content>
                  <Text variant="bodyMedium" style={{ color: palette.muted }}>No file changes yet.</Text>
                </Card.Content>
              </Card>
            ) : null}

            {(currentDiffs.length > 0 || diffDetails.length > 0) ? (
              <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}> 
                <Card.Content style={styles.diffListCardContent}>
                  <List.AccordionGroup expandedId={expandedDiffId} onAccordionPress={(id) => setExpandedDiffId(expandedDiffId === String(id) ? undefined : String(id))}>
                    {currentDiffs.map((diff) => {
                      const accordionId = `diff:${diff.file}`;
                      return <SessionDiffCard key={diff.file} accordionId={accordionId} diff={diff} expanded={expandedDiffId === accordionId} />;
                    })}
                    {currentDiffs.length === 0
                      ? diffDetails.map((detail) => {
                          const accordionId = `detail:${detail.id}`;
                          return <DiffCard key={detail.id} accordionId={accordionId} detail={detail} expanded={expandedDiffId === accordionId} />;
                        })
                      : null}
                  </List.AccordionGroup>
                </Card.Content>
              </Card>
            ) : null}
          </View>
        ) : null}

        {activeTab === 'session' && awaitingUserInput ? (
          <Card mode="contained" style={[styles.noticeCard, { backgroundColor: palette.surface }]}> 
            <Card.Content style={styles.waitingNoticeContent}>
              <View style={styles.waitingNoticeHeader}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.warning} />
                <Text variant="titleMedium" style={{ color: palette.text }}>Waiting for your input</Text>
              </View>
              <Text style={{ color: palette.muted }}>
                OpenCode is blocked on {pendingInteractions === 1 ? 'a response' : `${pendingInteractions} responses`} below.
              </Text>
            </Card.Content>
          </Card>
        ) : null}

        {activeTab === 'session' && running && !awaitingUserInput ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={palette.tint} />
            <Text style={{ color: palette.muted }}>
              {currentActivityLabel ? `OpenCode is ${currentActivityLabel.toLowerCase()}...` : 'OpenCode is working through the current step...'}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <Surface
        style={[styles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}
        elevation={4}>
        <View style={styles.controlsRow}>
          <MenuControl
            active={menu === 'mode'}
            iconName="robot-outline"
            maxWidth={84}
            label={selectedAgentLabel}
            onClose={() => setMenu(undefined)}
            onOpen={() => setMenu('mode')}>
            {availableAgents.map((agent) => (
              <Menu.Item
                key={agent.id}
                onPress={() => {
                  updateChatPreferences({ mode: agent.id });
                  setMenu(undefined);
                }}
                title={agent.label}
              />
            ))}
          </MenuControl>
          <MenuControl
            active={menu === 'model'}
            maxWidth={112}
            icon={(props) => renderProviderIcon(visibleModels.find((model) => model.id === chatPreferences.modelId)?.providerID, props.size, props.color)}
            label={getModelLabel(visibleModels, chatPreferences.modelId)}
            onClose={() => setMenu(undefined)}
            onOpen={() => setMenu('model')}>
            {visibleModels.map((model) => (
              <Menu.Item
                key={model.id}
                leadingIcon={(props) => renderProviderIcon(model.providerID, props.size, props.color)}
                onPress={() => {
                  updateChatPreferences({ providerId: model.providerID, modelId: model.id });
                  setMenu(undefined);
                }}
                title={model.label}
              />
            ))}
          </MenuControl>
          <MenuControl
            active={menu === 'reasoning'}
            iconName="brain"
            maxWidth={84}
            label={chatPreferences.reasoning}
            onClose={() => setMenu(undefined)}
            onOpen={() => setMenu('reasoning')}>
            {REASONING_OPTIONS.map((option) => (
              <Menu.Item
                key={option.id}
                onPress={() => {
                  updateChatPreferences({ reasoning: option.id });
                  setMenu(undefined);
                }}
                title={option.label}
              />
            ))}
          </MenuControl>
          <ControlButton
            active={chatPreferences.autoApprove}
            iconName={getAutoApproveIcon(chatPreferences.autoApprove)}
            iconOnly
            loading={isUpdatingAutoApprove}
            onPress={() => {
              setIsUpdatingAutoApprove(true);
              void setAutoApprove(!chatPreferences.autoApprove).finally(() => setIsUpdatingAutoApprove(false));
            }}>
            {chatPreferences.autoApprove ? 'Auto approve enabled' : 'Ask permission'}
          </ControlButton>
          <ControlButton iconName="paperclip" iconOnly onPress={() => void handleAttach()}>
            Files
          </ControlButton>
        </View>

        {conversationActive ? (
          <View style={[styles.conversationBanner, { backgroundColor: `${palette.tint}10`, borderColor: `${palette.tint}28` }]}>
            <View style={styles.conversationBannerHeader}>
              <Text variant="labelLarge" style={{ color: palette.text }}>
                Conversation mode
              </Text>
              <Chip compact icon={conversation.phase === 'speaking' ? 'volume-high' : 'microphone'}>
                {conversation.statusLabel || 'Active'}
              </Chip>
            </View>
            <Text variant="bodySmall" style={{ color: palette.muted }}>
              Keep talking naturally while the app stays open. It listens, sends your turn, reads the reply, and then listens again.
            </Text>
          </View>
        ) : null}

        {attachments.length > 0 ? (
          <View style={styles.attachmentRow}>
            {attachments.map((att, idx) => (
              <Chip
                key={`${att.uri}-${idx}`}
                compact
                mode="flat"
                style={[styles.attachmentChip, { backgroundColor: palette.background }]}
                onClose={() => setAttachments((current) => current.filter((_, index) => index !== idx))}>
                {att.filename || att.uri}
              </Chip>
            ))}
          </View>
        ) : null}

        {isSpeechInputListening || conversation.isListening ? (
          <View style={styles.voiceStatusRow}>
            <Chip compact icon="microphone" style={[styles.voiceStatusChip, { backgroundColor: `${palette.tint}14` }]}> 
              {conversationActive ? 'Conversation active' : 'Listening'}
            </Chip>
          </View>
        ) : null}

        <View style={[styles.inputShell, { borderColor: palette.border, backgroundColor: palette.background }]}> 
          <View style={styles.composerRow}>
            <TextInput
              testID="chat-prompt-input"
              mode="flat"
              value={draft}
              onChangeText={setDraft}
              editable={!isSpeechInputListening}
              multiline
              placeholder="Ask anything..."
              placeholderTextColor={palette.muted}
              style={[styles.input, { backgroundColor: 'transparent', color: palette.text }]}
              contentStyle={styles.inputContentCompact}
              underlineColor="transparent"
              activeUnderlineColor="transparent"
            />

            <IconButton
              testID="chat-voice-button"
              icon={isSpeechInputListening ? 'microphone-off' : 'microphone'}
              size={20}
              selected={isSpeechInputListening}
              style={styles.composerVoiceButton}
              disabled={conversationActive || connection.status !== 'connected' || (!isSpeechInputListening && !isSpeechInputAvailable)}
              onPress={() => {
                void handleToggleRecording();
              }}
            />

            <IconButton
              testID="chat-send-button"
              mode="contained"
              icon={showSendAction ? 'send' : 'stop'}
              size={20}
              style={styles.composerActionButton}
              loading={isStoppingSession}
              disabled={
                showSendAction
                  ? ((!draft.trim() && attachments.length === 0) || connection.status !== 'connected' || isCreatingSession || isSpeechInputListening)
                  : !currentSessionId || isStoppingSession
              }
              onPress={() => {
                if (!showSendAction) {
                  void handleAbort();
                  return;
                }

                void handleSendPrompt();
              }}
            />
          </View>
        </View>
      </Surface>

      <Snackbar
        visible={Boolean(copiedMessageId)}
        onDismiss={() => setCopiedMessageId(undefined)}
        duration={1800}>
        Message copied to clipboard
      </Snackbar>
      <Snackbar
        visible={Boolean(conversation.feedback || voiceFeedback)}
        onDismiss={() => {
          setVoiceFeedback(undefined);
          clearConversationFeedback();
        }}
        duration={3200}>
        {conversation.feedback || voiceFeedback}
      </Snackbar>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { elevation: 0 },
  headerMain: { flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  headerTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  headerSessionAnchor: { flex: 1, alignSelf: 'stretch', justifyContent: 'center', borderRadius: 14, marginRight: 8 },
  headerSessionContent: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, minHeight: 48, paddingRight: 4 },
  headerSessionTextWrap: { flex: 1, minWidth: 0 },
  sessionPickerOverlay: { ...StyleSheet.absoluteFillObject },
  sessionPickerBackdrop: { ...StyleSheet.absoluteFillObject },
  sessionPickerBackdropFill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  sessionPickerSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: 'hidden' },
  sessionPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  sessionPickerList: { padding: 12, gap: 8, paddingBottom: 24 },
  sessionPickerItem: { borderRadius: 16, borderWidth: 1 },
  voiceOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 12 },
  voiceOverlayGlow: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 999,
    opacity: 0.85,
  },
  voiceOverlayGlowTop: { top: -30, right: -50 },
  voiceOverlayGlowBottom: { bottom: 140, left: -70 },
  voiceOverlayContent: { flex: 1, paddingHorizontal: 22, paddingBottom: 22 },
  voiceOverlayHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  voiceOverlayHeaderCopy: { flex: 1, minWidth: 0, gap: 6 },
  voiceOverlayEyebrow: { letterSpacing: 0.6, textTransform: 'uppercase' },
  voiceOverlayTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  voiceOverlayStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  voiceOverlayCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  voiceOrbShell: {
    width: 252,
    height: 252,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  voiceOrbCore: {
    width: 212,
    height: 212,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#DDF7F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceOrbAura: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  voiceOrbBlobTop: {
    position: 'absolute',
    top: -8,
    left: 18,
    right: 18,
    height: 122,
    borderRadius: 999,
  },
  voiceOrbBlobBottom: {
    position: 'absolute',
    left: -8,
    right: -8,
    bottom: -6,
    height: 112,
    borderTopLeftRadius: 110,
    borderTopRightRadius: 130,
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
  },
  voiceOrbHighlight: {
    position: 'absolute',
    top: 26,
    left: 42,
    width: 70,
    height: 52,
    borderRadius: 999,
    transform: [{ rotate: '-18deg' }],
  },
  voiceOverlayMeta: { alignItems: 'center', gap: 10, maxWidth: 320 },
  voiceOverlayPhaseTitle: { fontFamily: Fonts.display, fontWeight: '700', textAlign: 'center' },
  voiceOverlayPhaseCopy: { textAlign: 'center', lineHeight: 24 },
  voiceOverlayFooter: { gap: 18, paddingBottom: 8 },
  voiceOverlaySnippetCard: {
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 8,
  },
  voiceOverlayDoneContent: { minHeight: 58 },
  voiceOverlayDoneLabel: { fontFamily: Fonts.display, fontSize: 18, fontWeight: '700' },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1 },
  topTab: { flex: 1 },
  topTabInner: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 12, gap: 12, paddingBottom: 20 },
  noticeCard: { borderRadius: 20 },
  waitingNoticeContent: { gap: 8 },
  waitingNoticeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emptyCard: { borderRadius: 22 },
  emptyContent: { gap: 14 },
  emptyTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  promptStack: { gap: 10 },
  promptCard: { borderWidth: 1, borderRadius: 18 },
  promptCardInner: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14 },
  sectionStack: { gap: 12 },
  sectionCard: { borderRadius: 18 },
  sectionHeaderCard: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  requestStack: { gap: 12 },
  paginationRow: { alignItems: 'center', paddingVertical: 4 },
  loadingRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8 },
  composer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.select({ ios: 24, default: 12 }),
    gap: 10,
    borderTopWidth: 1,
  },
  requestCard: { borderRadius: 22 },
  requestCardCompact: { borderRadius: 18 },
  requestCardContent: { gap: 12 },
  requestActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pendingInteractionsContent: { gap: 12 },
  questionList: { gap: 14 },
  questionBlock: { gap: 10 },
  questionHeader: { gap: 2 },
  questionOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  questionChip: { alignSelf: 'flex-start' },
  inputShell: { borderWidth: 1, borderRadius: 22, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  input: { flex: 1, minHeight: 22, maxHeight: 120, fontSize: 17, marginHorizontal: -4 },
  inputContentCompact: { paddingHorizontal: 0, paddingTop: 6, paddingBottom: 6, fontFamily: Fonts.sans },
  controlsRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'space-between' },
  controlButton: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 38,
    overflow: 'hidden',
  },
  controlButtonText: { minWidth: 0, flexShrink: 1 },
  controlButtonIconOnly: {
    width: 38,
  },
  controlButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minWidth: 0,
  },
  controlButtonInnerIconOnly: {
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  controlButtonLabel: {
    flexShrink: 1,
    fontFamily: Fonts.sans,
  },
  attachmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 2 },
  attachmentChip: { alignSelf: 'flex-start' },
  conversationBanner: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  conversationBannerHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  voiceStatusRow: { paddingHorizontal: 2 },
  voiceStatusChip: { alignSelf: 'flex-start' },
  composerVoiceButton: { margin: 0 },
  composerActionButton: { margin: 0 },
  messageRow: { alignItems: 'stretch' },
  messageRowUser: { alignItems: 'flex-end' },
  messageTouchable: { width: '100%', borderRadius: 22 },
  messageBubble: { maxWidth: '100%', padding: 16, borderRadius: 22, gap: 12, borderWidth: 1 },
  messageBubbleCopied: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  messageBubbleUser: { maxWidth: '88%' },
  messageBubbleAssistant: { width: '100%' },
  messageMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  messageMetaRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  messageActionButton: { margin: -6 },
  copiedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  markdownStack: { gap: 10 },
  markdownBulletRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  markdownBulletText: { flex: 1 },
  inlineCode: { fontFamily: Platform.select({ ios: Fonts.mono, default: 'monospace' }), fontSize: 15 },
  codeBlock: { borderRadius: 12, padding: 12, backgroundColor: 'rgba(127,127,127,0.12)' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryChip: { alignSelf: 'flex-start' },
  detailStack: { gap: 8 },
  detailCard: { borderRadius: 16 },
  detailContent: { gap: 8 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  detailTitleWrap: { flex: 1, gap: 2 },
  diffListCardContent: { paddingHorizontal: 0, paddingVertical: 0 },
  diffAccordion: { borderTopWidth: 1 },
  diffAccordionBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  diffContent: { gap: 8 },
  diffHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  diffViewer: { minWidth: '100%', gap: 1 },
  diffCollapsedRow: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 2,
  },
  diffLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderLeftWidth: 3,
    paddingVertical: 6,
    paddingRight: 12,
    minHeight: 36,
  },
  diffLineNumber: {
    width: 38,
    textAlign: 'right',
    paddingTop: 1,
    paddingRight: 8,
  },
  diffMarker: {
    width: 18,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: Fonts.mono, default: 'monospace' }),
    paddingTop: 1,
  },
  diffLineText: {
    flex: 1,
    minWidth: 220,
  },
  code: { fontFamily: Platform.select({ ios: Fonts.mono, default: 'monospace' }) },
  divider: { marginVertical: 4 },
});
