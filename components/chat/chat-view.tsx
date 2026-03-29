import { useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
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
import { useOpencode } from '@/providers/opencode-provider';

const STARTER_PROMPTS = [
  'Build a polished onboarding flow for this Expo app.',
  'Refactor this screen to feel more like ChatGPT mobile.',
  'Connect the current app to a real backend with loading and error states.',
];

export function ChatView() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const scrollRef = useRef<any>(null);
  const {
    activeSession,
    connection,
    currentSessionId,
    currentTranscript,
    isBootstrappingChat,
    isRefreshingMessages,
    sendPrompt,
    sendingState,
    sessionStatuses,
  } = useOpencode();
  const [draft, setDraft] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'diffs'>('chat');

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

  async function handleSendPrompt(promptOverride?: string) {
    const prompt = (promptOverride ?? draft).trim();
    if (!currentSessionId || !prompt) {
      return;
    }

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
          active={activeTab === 'chat'}
          label="Chat"
          onPress={() => setActiveTab('chat')}
        />
        <SegmentButton
          active={activeTab === 'diffs'}
          label="Diffs"
          onPress={() => setActiveTab('diffs')}
        />
      </HStack>

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
        {connection.status === 'error' ? (
          <VStack style={[styles.inlineNotice, { backgroundColor: palette.card, borderColor: palette.border }]}> 
            <Text style={[styles.noticeTitle, { color: palette.text }]}>Connection issue</Text>
            <Text style={[styles.noticeCopy, { color: palette.muted }]}>{connection.message}</Text>
          </VStack>
          ) : null}

        {activeTab === 'chat' && currentTranscript.length === 0 ? (
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

        {activeTab === 'chat'
          ? currentTranscript.map((entry) => <TranscriptMessage key={entry.id} entry={entry} />)
          : null}

        {activeTab === 'diffs' ? (
          <VStack style={styles.diffStack}>
            <VStack style={[styles.diffSummaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
              <Text style={[styles.diffSummaryEyebrow, { color: palette.accent }]}>Current changes</Text>
              <Heading style={[styles.diffSummaryTitle, { color: palette.text }]}>Session diff</Heading>
              <Text style={[styles.diffSummaryCopy, { color: palette.muted }]}>
                {activeSession ? getSessionSubtitle(activeSession) : sessionMeta}
              </Text>
              <HStack style={styles.diffMetaRow}>
                <Text style={[styles.diffMetaText, { color: palette.muted }]}>{sessionMeta}</Text>
                <Text style={[styles.diffMetaText, { color: palette.accent }]}>{status?.type || 'idle'}</Text>
              </HStack>
            </VStack>

            {diffDetails.length === 0 ? (
              <VStack style={[styles.diffEmptyCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
                <Text style={[styles.diffEmptyTitle, { color: palette.text }]}>No diff artifacts yet</Text>
                <Text style={[styles.diffEmptyCopy, { color: palette.muted }]}>Ask OpenCode to edit files and patch details will appear here.</Text>
              </VStack>
            ) : (
              diffDetails.map((detail) => <DiffCard key={detail.id} detail={detail} />)
            )}
          </VStack>
        ) : null}

        {activeTab === 'chat' && (sendingState.active || isBootstrappingChat || isRefreshingMessages) && currentTranscript.length > 0 ? (
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
  diffCardLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: '700' },
  diffCardTitle: { fontSize: 18, lineHeight: 22, fontFamily: Fonts.display },
  diffCardBody: { fontSize: 13, lineHeight: 20, fontFamily: Fonts.mono },
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
  composerInputShell: { borderWidth: 0 },
  composerInput: { minHeight: 52, maxHeight: 160, fontSize: 16, lineHeight: 22, paddingHorizontal: 6 },
  composerFooter: { justifyContent: 'space-between', gap: 12 },
  composerMeta: { flex: 1, fontSize: 12, lineHeight: 18 },
  sendButton: { minWidth: 82, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  sendButtonText: { fontSize: 15, fontWeight: '700' },
});
