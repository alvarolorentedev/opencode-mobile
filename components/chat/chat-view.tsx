import { useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import type { FileDiff } from '@opencode-ai/sdk/client';
import {
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Input,
  InputField,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Spinner,
  Text,
  VStack,
} from '@gluestack-ui/themed';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  formatRelativeTime,
  formatTimestamp,
  getSessionSubtitle,
  type TranscriptDetail,
  type TranscriptEntry,
} from '@/lib/opencode/format';
import {
  type AgentOption,
  type ModelOption,
  type ReasoningLevel,
  useOpencode,
} from '@/providers/opencode-provider';

const STARTER_PROMPTS = [
  'Build a polished onboarding flow for this Expo app.',
  'Refactor this screen to feel more like ChatGPT mobile.',
  'Connect the current app to a real backend with loading and error states.',
];

const REASONING_OPTIONS: { id: ReasoningLevel; label: string; description: string }[] = [
  { id: 'low', label: 'Low', description: 'Move faster with lighter planning.' },
  { id: 'default', label: 'Default', description: 'Use the normal OpenCode balance.' },
  { id: 'high', label: 'High', description: 'Spend longer reasoning before acting.' },
];

function formatControlLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getModelLabel(models: ModelOption[], modelId?: string) {
  return models.find((model) => model.id === modelId)?.label || 'Model';
}

function clipBlock(value: string, limit = 18) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'No content';
  }

  const lines = trimmed.split('\n');
  if (lines.length <= limit) {
    return trimmed;
  }

  return `${lines.slice(0, limit).join('\n')}\n...`;
}

export function ChatView() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const scrollRef = useRef<any>(null);
  const {
    activeSession,
    availableAgents,
    availableModels,
    chatPreferences,
    connection,
    currentDiffs,
    currentSessionId,
    currentTranscript,
    isRefreshingDiffs,
    isBootstrappingChat,
    isRefreshingMessages,
    setAutoApprove,
    sendPrompt,
    sendingState,
    sessionStatuses,
    updateChatPreferences,
  } = useOpencode();
  const [draft, setDraft] = useState('');
  const [activeTab, setActiveTab] = useState<'session' | 'changes'>('session');
  const [activePicker, setActivePicker] = useState<'mode' | 'model' | 'reasoning' | undefined>();
  const [isUpdatingAutoApprove, setIsUpdatingAutoApprove] = useState(false);

  const status = currentSessionId ? sessionStatuses[currentSessionId] : undefined;
  const sessionMeta = useMemo(() => {
    if (!activeSession) {
      return 'Syncing chat';
    }

    return `Updated ${formatRelativeTime(activeSession.time.updated)}`;
  }, [activeSession]);

  const diffDetails = useMemo(
    () =>
      currentTranscript.flatMap((entry) =>
        entry.details.filter((detail) => detail.kind === 'patch' || detail.kind === 'file'),
      ),
    [currentTranscript],
  );
  const selectedModelLabel = useMemo(
    () => getModelLabel(availableModels, chatPreferences.modelId),
    [availableModels, chatPreferences.modelId],
  );

  async function handleSendPrompt(promptOverride?: string) {
    const prompt = (promptOverride ?? draft).trim();
    if (!currentSessionId || !prompt) {
      return;
    }

    setActivePicker(undefined);
    setDraft('');
    await sendPrompt(currentSessionId, prompt);
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: palette.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <HStack style={[styles.segmentRow, { backgroundColor: palette.background }]}> 
        <SegmentButton
          active={activeTab === 'session'}
          label="Session"
          onPress={() => setActiveTab('session')}
        />
        <SegmentButton
          active={activeTab === 'changes'}
          label={`Changes${currentDiffs.length > 0 ? ` (${currentDiffs.length})` : ''}`}
          onPress={() => setActiveTab('changes')}
        />
      </HStack>

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        {connection.status === 'error' ? (
          <VStack style={[styles.inlineNotice, { backgroundColor: palette.card, borderColor: palette.border }]}> 
            <Text style={[styles.noticeTitle, { color: palette.text }]}>Connection issue</Text>
            <Text style={[styles.noticeCopy, { color: palette.muted }]}>{connection.message}</Text>
          </VStack>
          ) : null}

        {activeTab === 'session' && currentTranscript.length === 0 ? (
          <VStack style={styles.emptyState}>
            <VStack style={[styles.assistantIntro, { backgroundColor: palette.card, borderColor: palette.border }]}> 
              <Text style={[styles.assistantIntroEyebrow, { color: palette.accent }]}>New chat</Text>
              <Heading style={[styles.assistantIntroTitle, { color: palette.text }]}>How can I help with this app?</Heading>
              <Text style={[styles.assistantIntroCopy, { color: palette.muted }]}>OpenCode is connected. Start with a concrete task and I will work through the codebase with you.</Text>
            </VStack>
            <VStack style={styles.promptGrid}>
              {STARTER_PROMPTS.map((prompt) => (
                <Pressable
                  key={prompt}
                  onPress={() => void handleSendPrompt(prompt)}
                  style={({ pressed }) => [
                    styles.promptCard,
                    {
                      backgroundColor: palette.surface,
                      borderColor: palette.border,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}>
                  <Text style={[styles.promptCardText, { color: palette.text }]}>{prompt}</Text>
                </Pressable>
              ))}
            </VStack>
          </VStack>
        ) : null}

        {activeTab === 'session'
          ? currentTranscript.map((entry) => <TranscriptMessage key={entry.id} entry={entry} />)
          : null}

        {activeTab === 'changes' ? (
          <VStack style={styles.diffStack}>
            <VStack style={[styles.diffSummaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
              <Text style={[styles.diffSummaryEyebrow, { color: palette.accent }]}>Current changes</Text>
              <Heading style={[styles.diffSummaryTitle, { color: palette.text }]}>Session changes</Heading>
              <Text style={[styles.diffSummaryCopy, { color: palette.muted }]}> 
                {activeSession ? getSessionSubtitle(activeSession) : sessionMeta}
              </Text>
              <HStack style={styles.diffMetaRow}>
                <Text style={[styles.diffMetaText, { color: palette.muted }]}>{sessionMeta}</Text>
                <Text style={[styles.diffMetaText, { color: palette.accent }]}>
                  {isRefreshingDiffs ? 'syncing' : status?.type || 'idle'}
                </Text>
              </HStack>
            </VStack>

            {currentDiffs.length === 0 && diffDetails.length === 0 ? (
              <VStack style={[styles.diffEmptyCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
                <Text style={[styles.diffEmptyTitle, { color: palette.text }]}>No file changes yet</Text>
                <Text style={[styles.diffEmptyCopy, { color: palette.muted }]}>Ask OpenCode to edit files and this tab will show the session changes here.</Text>
              </VStack>
            ) : (
              <>
                {currentDiffs.map((diff) => (
                  <SessionDiffCard key={diff.file} diff={diff} />
                ))}
                {currentDiffs.length === 0 ? diffDetails.map((detail) => <DiffCard key={detail.id} detail={detail} />) : null}
              </>
            )}
          </VStack>
        ) : null}

        {activeTab === 'session' && (sendingState.active || isBootstrappingChat || isRefreshingMessages) && currentTranscript.length > 0 ? (
          <HStack style={styles.assistantRow}>
            <Box style={[styles.avatar, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}> 
              <Text style={[styles.avatarText, { color: palette.text }]}>O</Text>
            </Box>
            <HStack style={[styles.typingBubble, { backgroundColor: palette.card, borderColor: palette.border }]} alignItems="center">
              <Spinner size="small" color={palette.tint} />
              <Text style={[styles.typingText, { color: palette.muted }]}>OpenCode is thinking...</Text>
            </HStack>
          </HStack>
        ) : null}
      </ScrollView>

      <Box style={[styles.composerWrap, { borderTopColor: palette.border, backgroundColor: palette.background }]}> 
        <VStack style={[styles.composerCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
          {activePicker ? (
            <PickerPanel
              activePicker={activePicker}
              agents={availableAgents}
              modelId={chatPreferences.modelId}
              models={availableModels}
              mode={chatPreferences.mode}
              onClose={() => setActivePicker(undefined)}
              onSelectAgent={(mode) => {
                updateChatPreferences({ mode });
                setActivePicker(undefined);
              }}
              onSelectModel={(modelId) => {
                updateChatPreferences({ modelId });
                setActivePicker(undefined);
              }}
              onSelectReasoning={(reasoning) => {
                updateChatPreferences({ reasoning });
                setActivePicker(undefined);
              }}
              reasoning={chatPreferences.reasoning}
            />
          ) : null}
          <Input style={[styles.composerInputShell, { borderColor: palette.border, backgroundColor: palette.surface }]}> 
            <InputField
              value={draft}
              onChangeText={setDraft}
              placeholder="Message OpenCode"
              placeholderTextColor={palette.icon}
              multiline
              textAlignVertical="top"
              color={palette.text}
              style={styles.composerInput}
            />
          </Input>
          <HStack style={styles.composerFooter} alignItems="flex-end">
            <Text style={[styles.composerMeta, { color: palette.muted }]}>
              {connection.status === 'connected' ? 'Showing the latest chat or the one you selected from Chats.' : connection.message}
            </Text>
            <Button
              isDisabled={!draft.trim() || sendingState.active || connection.status !== 'connected'}
              onPress={() => void handleSendPrompt()}
              style={[styles.sendButton, { backgroundColor: draft.trim() ? palette.tint : palette.surfaceAlt }]}
              sx={{ ':disabled': { opacity: 0.55 } }}>
              <ButtonText style={[styles.sendButtonText, { color: draft.trim() ? palette.background : palette.muted }]}>Send</ButtonText>
            </Button>
          </HStack>
          <HStack style={styles.controlRow}>
            <ComposerControl
              active={activePicker === 'mode'}
              label={formatControlLabel(chatPreferences.mode)}
              onPress={() => setActivePicker((current) => (current === 'mode' ? undefined : 'mode'))}
            />
            <ComposerControl
              active={activePicker === 'model'}
              label={selectedModelLabel}
              onPress={() => setActivePicker((current) => (current === 'model' ? undefined : 'model'))}
            />
            <ComposerControl
              active={activePicker === 'reasoning'}
              label={formatControlLabel(chatPreferences.reasoning)}
              onPress={() => setActivePicker((current) => (current === 'reasoning' ? undefined : 'reasoning'))}
            />
            <ComposerControl
              active={chatPreferences.autoApprove}
              disabled={isUpdatingAutoApprove}
              label={chatPreferences.autoApprove ? 'Auto-approve' : 'Ask first'}
              onPress={() => {
                setIsUpdatingAutoApprove(true);
                void setAutoApprove(!chatPreferences.autoApprove).finally(() => setIsUpdatingAutoApprove(false));
              }}
            />
          </HStack>
        </VStack>
      </Box>
    </KeyboardAvoidingView>
  );
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.segmentButton,
        {
          backgroundColor: active ? palette.surface : palette.background,
          borderColor: palette.border,
          opacity: pressed ? 0.88 : 1,
        },
      ]}>
      <Text style={[styles.segmentLabel, { color: active ? palette.text : palette.muted }]}>{label}</Text>
    </Pressable>
  );
}

function ComposerControl({
  active,
  disabled,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlChip,
        {
          backgroundColor: active ? palette.surfaceAlt : palette.surface,
          borderColor: active ? palette.tint : palette.border,
          opacity: disabled ? 0.45 : pressed ? 0.88 : 1,
        },
      ]}>
      <Text style={[styles.controlChipLabel, { color: active ? palette.text : palette.muted }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function PickerPanel({
  activePicker,
  agents,
  mode,
  modelId,
  models,
  onClose,
  onSelectAgent,
  onSelectModel,
  onSelectReasoning,
  reasoning,
}: {
  activePicker: 'mode' | 'model' | 'reasoning';
  agents: AgentOption[];
  mode: string;
  modelId?: string;
  models: ModelOption[];
  onClose: () => void;
  onSelectAgent: (mode: string) => void;
  onSelectModel: (modelId: string) => void;
  onSelectReasoning: (reasoning: ReasoningLevel) => void;
  reasoning: ReasoningLevel;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <VStack style={[styles.pickerPanel, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <HStack style={styles.pickerHeader}>
        <Text style={[styles.pickerTitle, { color: palette.text }]}>Select {activePicker}</Text>
        <Pressable onPress={onClose}>
          <Text style={[styles.pickerClose, { color: palette.accent }]}>Done</Text>
        </Pressable>
      </HStack>

      {activePicker === 'mode'
        ? agents.map((agent) => (
            <PickerOption
              key={agent.id}
              active={agent.id === mode}
              description={agent.description}
              label={agent.label}
              onPress={() => onSelectAgent(agent.id)}
            />
          ))
        : null}

      {activePicker === 'model'
        ? models.map((model) => (
            <PickerOption
              key={model.id}
              active={model.id === modelId}
              description={model.supportsReasoning ? 'Supports reasoning controls' : 'Standard model'}
              label={model.label}
              onPress={() => onSelectModel(model.id)}
            />
          ))
        : null}

      {activePicker === 'reasoning'
        ? REASONING_OPTIONS.map((option) => (
            <PickerOption
              key={option.id}
              active={option.id === reasoning}
              description={option.description}
              label={option.label}
              onPress={() => onSelectReasoning(option.id)}
            />
          ))
        : null}
    </VStack>
  );
}

function PickerOption({
  active,
  description,
  label,
  onPress,
}: {
  active: boolean;
  description?: string;
  label: string;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pickerOption,
        {
          backgroundColor: active ? palette.surfaceAlt : palette.surface,
          borderColor: active ? palette.tint : palette.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}>
      <Text style={[styles.pickerOptionLabel, { color: palette.text }]}>{label}</Text>
      {description ? <Text style={[styles.pickerOptionDescription, { color: palette.muted }]}>{description}</Text> : null}
    </Pressable>
  );
}

function SessionDiffCard({ diff }: { diff: FileDiff }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [expanded, setExpanded] = useState(false);

  return (
    <VStack style={[styles.diffCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
      <Pressable onPress={() => setExpanded((current) => !current)} style={styles.detailHeader}>
        <VStack style={styles.diffFileMeta}>
          <Text style={[styles.diffCardLabel, { color: palette.accent }]}>Modified file</Text>
          <Heading style={[styles.diffCardTitle, { color: palette.text }]}>{diff.file}</Heading>
        </VStack>
        <Text style={[styles.detailToggle, { color: palette.accent }]}>{expanded ? 'Hide' : 'Open'}</Text>
      </Pressable>
      <HStack style={styles.diffStatRow}>
        <Text style={[styles.diffStatText, { color: palette.success }]}>+{diff.additions}</Text>
        <Text style={[styles.diffStatText, { color: palette.danger }]}>-{diff.deletions}</Text>
      </HStack>
      {expanded ? (
        <VStack style={styles.diffPreviewStack}>
          <VStack style={[styles.diffPreviewCard, { backgroundColor: palette.surfaceAlt }]}> 
            <Text style={[styles.diffPreviewLabel, { color: palette.muted }]}>Before</Text>
            <Text style={[styles.diffCardBody, { color: palette.text }]}>{clipBlock(diff.before)}</Text>
          </VStack>
          <VStack style={[styles.diffPreviewCard, { backgroundColor: palette.surfaceAlt }]}> 
            <Text style={[styles.diffPreviewLabel, { color: palette.muted }]}>After</Text>
            <Text style={[styles.diffCardBody, { color: palette.text }]}>{clipBlock(diff.after)}</Text>
          </VStack>
        </VStack>
      ) : null}
    </VStack>
  );
}

function DiffCard({ detail }: { detail: Extract<TranscriptDetail, { kind: 'patch' | 'file' }> }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <VStack style={[styles.diffCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
      <Text style={[styles.diffCardLabel, { color: palette.accent }]}>{detail.kind === 'patch' ? 'Patch' : 'File'}</Text>
      <Heading style={[styles.diffCardTitle, { color: palette.text }]}>{detail.label}</Heading>
      <Text style={[styles.diffCardBody, { color: palette.muted }]}>{detail.body}</Text>
    </VStack>
  );
}

function TranscriptMessage({ entry }: { entry: TranscriptEntry }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isUser = entry.role === 'user';

  return (
    <Box style={isUser ? styles.userRow : styles.assistantRow}>
      {!isUser ? (
        <Box style={[styles.avatar, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}> 
          <Text style={[styles.avatarText, { color: palette.text }]}>O</Text>
        </Box>
      ) : null}

      <VStack
        style={[
          isUser ? styles.userBubble : styles.assistantBubble,
          {
            backgroundColor: isUser ? palette.bubbleUser : palette.bubbleAssistant,
            borderColor: isUser ? palette.bubbleUser : palette.border,
          },
        ]}>
        <HStack style={styles.messageMetaRow}>
          <Text style={[styles.messageLabel, { color: isUser ? palette.surfaceAlt : palette.accent }]}>{isUser ? 'You' : 'OpenCode'}</Text>
          <Text style={[styles.messageLabel, { color: isUser ? palette.surfaceAlt : palette.icon }]}>{formatTimestamp(entry.createdAt)}</Text>
        </HStack>

        {entry.text ? <Text style={[styles.messageText, { color: isUser ? palette.background : palette.text }]}>{entry.text}</Text> : null}

        {entry.error ? (
          <Box style={[styles.errorBox, { backgroundColor: isUser ? 'rgba(255,255,255,0.12)' : palette.surfaceAlt }]}> 
            <Text style={[styles.errorText, { color: isUser ? palette.background : palette.danger }]}>{entry.error}</Text>
          </Box>
        ) : null}

        {!isUser && entry.details.length > 0 ? (
          <VStack style={styles.detailStack}>
            {entry.details.map((detail) => (
              <DetailDisclosure key={detail.id} detail={detail} />
            ))}
          </VStack>
        ) : null}
      </VStack>
    </Box>
  );
}

function DetailDisclosure({ detail }: { detail: TranscriptDetail }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [open, setOpen] = useState(detail.kind === 'tool' && detail.status === 'running');

  return (
    <VStack style={[styles.detailCard, { borderColor: palette.border, backgroundColor: palette.surfaceAlt }]}> 
      <Pressable onPress={() => setOpen((current) => !current)} style={styles.detailHeader}>
        <Text style={[styles.detailTitle, { color: palette.text }]} numberOfLines={1}>{detail.label}</Text>
        <Text style={[styles.detailToggle, { color: palette.accent }]}>{open ? 'Hide' : 'Show'}</Text>
      </Pressable>
      {open ? <Text style={[styles.detailBody, { color: palette.muted }]}>{detail.body}</Text> : null}
    </VStack>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  segmentRow: { gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: { fontSize: 14, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 32, gap: 22 },
  inlineNotice: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 6 },
  noticeTitle: { fontSize: 15, fontWeight: '700' },
  noticeCopy: { fontSize: 14, lineHeight: 20 },
  emptyState: { gap: 18, paddingTop: 12 },
  assistantIntro: { borderWidth: 1, borderRadius: 28, padding: 22, gap: 10 },
  assistantIntroEyebrow: { fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', fontWeight: '700' },
  assistantIntroTitle: { fontSize: 32, lineHeight: 36, fontFamily: Fonts.display },
  assistantIntroCopy: { fontSize: 15, lineHeight: 22 },
  promptGrid: { gap: 12 },
  promptCard: { borderWidth: 1, borderRadius: 22, padding: 16 },
  promptCardText: { fontSize: 15, lineHeight: 22 },
  diffStack: { gap: 14 },
  diffSummaryCard: { borderWidth: 1, borderRadius: 24, padding: 18, gap: 8 },
  diffSummaryEyebrow: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: '700' },
  diffSummaryTitle: { fontSize: 24, lineHeight: 28, fontFamily: Fonts.display },
  diffSummaryCopy: { fontSize: 15, lineHeight: 22 },
  diffMetaRow: { justifyContent: 'space-between', gap: 12 },
  diffMetaText: { fontSize: 13 },
  diffEmptyCard: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 8 },
  diffEmptyTitle: { fontSize: 18, fontWeight: '700' },
  diffEmptyCopy: { fontSize: 15, lineHeight: 22 },
  diffCard: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 8 },
  diffFileMeta: { flex: 1, gap: 4 },
  diffCardLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: '700' },
  diffCardTitle: { fontSize: 18, lineHeight: 22, fontFamily: Fonts.display },
  diffCardBody: { fontSize: 13, lineHeight: 20, fontFamily: Fonts.mono },
  diffStatRow: { gap: 12 },
  diffStatText: { fontSize: 13, fontWeight: '700' },
  diffPreviewStack: { gap: 10 },
  diffPreviewCard: { borderRadius: 16, padding: 12, gap: 6 },
  diffPreviewLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  assistantRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  userRow: { alignItems: 'flex-end' },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 6, borderWidth: 1 },
  avatarText: { fontSize: 13, fontWeight: '700' },
  assistantBubble: { flex: 1, borderWidth: 1, borderRadius: 26, paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  userBubble: { maxWidth: '82%', borderWidth: 1, borderRadius: 26, paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  messageMetaRow: { justifyContent: 'space-between', gap: 12 },
  messageLabel: { fontSize: 12, fontWeight: '600' },
  messageText: { fontSize: 16, lineHeight: 25 },
  errorBox: { borderRadius: 16, padding: 12 },
  errorText: { fontSize: 14, lineHeight: 20 },
  detailStack: { gap: 10 },
  detailCard: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 8 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  detailTitle: { flex: 1, fontSize: 14, fontWeight: '700' },
  detailToggle: { fontSize: 13, fontWeight: '700' },
  detailBody: { fontSize: 13, lineHeight: 20, fontFamily: Fonts.mono },
  typingBubble: { gap: 10, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 12 },
  typingText: { fontSize: 14 },
  composerWrap: { borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: Platform.select({ ios: 24, default: 16 }) },
  composerCard: { borderWidth: 1, borderRadius: 28, paddingTop: 10, paddingHorizontal: 12, paddingBottom: 10, gap: 12 },
  pickerPanel: { borderWidth: 1, borderRadius: 22, padding: 12, gap: 10 },
  pickerHeader: { justifyContent: 'space-between', alignItems: 'center' },
  pickerTitle: { fontSize: 14, fontWeight: '700' },
  pickerClose: { fontSize: 13, fontWeight: '700' },
  pickerOption: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, gap: 3 },
  pickerOptionLabel: { fontSize: 14, fontWeight: '700' },
  pickerOptionDescription: { fontSize: 12, lineHeight: 18 },
  composerInputShell: { borderWidth: 0 },
  composerInput: { minHeight: 52, maxHeight: 160, fontSize: 16, lineHeight: 22, paddingHorizontal: 6 },
  composerFooter: { justifyContent: 'space-between', gap: 12 },
  composerMeta: { flex: 1, fontSize: 12, lineHeight: 18 },
  controlRow: { gap: 8, flexWrap: 'wrap' },
  controlChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9, maxWidth: '48%' },
  controlChipLabel: { fontSize: 13, fontWeight: '700' },
  sendButton: { minWidth: 82, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  sendButtonText: { fontSize: 15, fontWeight: '700' },
});
