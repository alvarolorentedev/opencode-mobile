import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import type { FileDiff, Todo } from '@/lib/opencode/types';
import {
  ActivityIndicator,
  Appbar,
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  List,
  Menu,
  Portal,
  Surface,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PendingPermissionRequest, PendingQuestionAnswer, PendingQuestionRequest } from '@/lib/opencode/client';
import {
  formatTimestamp,
  getSessionSubtitle,
  type TranscriptDetail,
  type TranscriptEntry,
} from '@/lib/opencode/format';
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

type DiffLine = {
  kind: 'context' | 'added' | 'removed';
  leftNumber?: number;
  rightNumber?: number;
  text: string;
};

type DiffBlock =
  | { type: 'lines'; lines: DiffLine[] }
  | { type: 'collapsed'; hiddenCount: number; startLine?: number; endLine?: number };

const DIFF_CONTEXT_LINES = 3;

function buildLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  const rowCount = beforeLines.length;
  const columnCount = afterLines.length;
  const table = Array.from({ length: rowCount + 1 }, () => Array<number>(columnCount + 1).fill(0));

  for (let row = rowCount - 1; row >= 0; row -= 1) {
    for (let column = columnCount - 1; column >= 0; column -= 1) {
      table[row][column] =
        beforeLines[row] === afterLines[column]
          ? table[row + 1][column + 1] + 1
          : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }

  const result: DiffLine[] = [];
  let row = 0;
  let column = 0;
  let leftNumber = 1;
  let rightNumber = 1;

  while (row < rowCount && column < columnCount) {
    if (beforeLines[row] === afterLines[column]) {
      result.push({
        kind: 'context',
        leftNumber,
        rightNumber,
        text: beforeLines[row],
      });
      row += 1;
      column += 1;
      leftNumber += 1;
      rightNumber += 1;
      continue;
    }

    if (table[row + 1][column] >= table[row][column + 1]) {
      result.push({
        kind: 'removed',
        leftNumber,
        text: beforeLines[row],
      });
      row += 1;
      leftNumber += 1;
      continue;
    }

    result.push({
      kind: 'added',
      rightNumber,
      text: afterLines[column],
    });
    column += 1;
    rightNumber += 1;
  }

  while (row < rowCount) {
    result.push({
      kind: 'removed',
      leftNumber,
      text: beforeLines[row],
    });
    row += 1;
    leftNumber += 1;
  }

  while (column < columnCount) {
    result.push({
      kind: 'added',
      rightNumber,
      text: afterLines[column],
    });
    column += 1;
    rightNumber += 1;
  }

  return result;
}

function getDiffPalette(kind: DiffLine['kind'], palette: (typeof Colors)['light']) {
  if (kind === 'added') {
    return {
      backgroundColor: 'rgba(86, 207, 142, 0.14)',
      accentColor: '#56cf8e',
    };
  }

  if (kind === 'removed') {
    return {
      backgroundColor: 'rgba(255, 107, 107, 0.14)',
      accentColor: palette.danger,
    };
  }

  return {
    backgroundColor: palette.background,
    accentColor: 'transparent',
  };
}

function buildCollapsedDiffBlocks(lines: DiffLine[], contextSize = DIFF_CONTEXT_LINES): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    if (lines[index].kind !== 'context') {
      const changedLines: DiffLine[] = [];
      while (index < lines.length && lines[index].kind !== 'context') {
        changedLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'lines', lines: changedLines });
      continue;
    }

    const contextStart = index;
    while (index < lines.length && lines[index].kind === 'context') {
      index += 1;
    }

    const contextLines = lines.slice(contextStart, index);
    const isLeading = contextStart === 0;
    const isTrailing = index === lines.length;

    if (contextLines.length <= contextSize * 2 || (isLeading && isTrailing)) {
      blocks.push({ type: 'lines', lines: contextLines });
      continue;
    }

    if (isLeading) {
      blocks.push({ type: 'lines', lines: contextLines.slice(0, contextSize) });
      blocks.push({
        type: 'collapsed',
        hiddenCount: contextLines.length - contextSize,
        startLine: contextLines[contextSize]?.leftNumber,
        endLine: contextLines[contextLines.length - 1]?.leftNumber,
      });
      continue;
    }

    if (isTrailing) {
      blocks.push({
        type: 'collapsed',
        hiddenCount: contextLines.length - contextSize,
        startLine: contextLines[0]?.leftNumber,
        endLine: contextLines[contextLines.length - contextSize - 1]?.leftNumber,
      });
      blocks.push({ type: 'lines', lines: contextLines.slice(-contextSize) });
      continue;
    }

    blocks.push({ type: 'lines', lines: contextLines.slice(0, contextSize) });
    blocks.push({
      type: 'collapsed',
      hiddenCount: contextLines.length - contextSize * 2,
      startLine: contextLines[contextSize]?.leftNumber,
      endLine: contextLines[contextLines.length - contextSize - 1]?.leftNumber,
    });
    blocks.push({ type: 'lines', lines: contextLines.slice(-contextSize) });
  }

  return blocks.filter((block) => block.type === 'lines' || block.hiddenCount > 0);
}

function getPermissionTitle(request: PendingPermissionRequest) {
  return request.permission
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getTodoTone(priority: string, palette: (typeof Colors)['light']) {
  if (priority === 'high') {
    return palette.warning;
  }

  if (priority === 'low') {
    return palette.muted;
  }

  return palette.tint;
}

function summarizeDetails(details: TranscriptDetail[]) {
  const patches = details.filter((detail) => detail.kind === 'patch').length;
  const files = details.filter((detail) => detail.kind === 'file').length;
  const runningTool = details.find((detail) => detail.kind === 'tool' && detail.status === 'running');
  const failedRetry = details.find((detail) => detail.kind === 'retry');
  const summaries: string[] = [];

  if (runningTool) {
    summaries.push(runningTool.label);
  }

  if (patches > 0) {
    summaries.push(`Updated ${patches} patch${patches === 1 ? '' : 'es'}`);
  }

  if (files > 0) {
    summaries.push(`${files} file${files === 1 ? '' : 's'}`);
  }

  if (failedRetry) {
    summaries.push(failedRetry.label);
  }

  return summaries;
}

function getActivityLabel(entry: TranscriptEntry) {
  const runningTool = entry.details.find((detail) => detail.kind === 'tool' && detail.status === 'running');
  if (runningTool) {
    return runningTool.label;
  }

  const latestTool = [...entry.details].reverse().find((detail) => detail.kind === 'tool');
  if (latestTool) {
    return latestTool.label;
  }

  const latestPatch = [...entry.details].reverse().find((detail) => detail.kind === 'patch');
  if (latestPatch) {
    return latestPatch.label;
  }

  const latestReasoning = [...entry.details].reverse().find((detail) => detail.kind === 'reasoning');
  if (latestReasoning) {
    return latestReasoning.label;
  }

  const latestStep = [...entry.details].reverse().find((detail) => detail.kind === 'step' || detail.kind === 'subtask');
  if (latestStep) {
    return latestStep.label;
  }

  return undefined;
}

function isDisplayMessage(entry: TranscriptEntry) {
  if (entry.role === 'user') {
    return true;
  }

  return Boolean(entry.text.trim() || entry.error);
}

function renderInlineMarkdown(text: string, color: string, codeColor: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <Text key={`inline-${index}`} style={[styles.inlineCode, { color: codeColor }]}> 
          {part.slice(1, -1)}
        </Text>
      );
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={`inline-${index}`} style={{ color, fontWeight: '700' }}>
          {part.slice(2, -2)}
        </Text>
      );
    }

    return (
      <Text key={`inline-${index}`} style={{ color }}>
        {part}
      </Text>
    );
  });
}

function MarkdownText({ text, color, mutedColor }: { text: string; color: string; mutedColor: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let codeBlock: string[] = [];
  let inCodeBlock = false;

  function pushParagraph() {
    if (paragraph.length === 0) {
      return;
    }

    const content = paragraph.join(' ').trim();
    if (content) {
      blocks.push(
        <Text key={`p-${blocks.length}`} variant="bodyLarge" style={{ color, lineHeight: 26 }}>
          {renderInlineMarkdown(content, color, mutedColor)}
        </Text>,
      );
    }
    paragraph = [];
  }

  function pushCodeBlock() {
    if (codeBlock.length === 0) {
      return;
    }

    blocks.push(
      <View key={`code-${blocks.length}`} style={styles.codeBlock}>
        <Text variant="bodySmall" style={[styles.code, { color }]}>
          {codeBlock.join('\n')}
        </Text>
      </View>,
    );
    codeBlock = [];
  }

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        pushCodeBlock();
      } else {
        pushParagraph();
      }
      inCodeBlock = !inCodeBlock;
      return;
    }

    if (inCodeBlock) {
      codeBlock.push(line);
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      pushParagraph();
      blocks.push(
        <Text
          key={`h-${blocks.length}`}
          variant={heading[1].length === 1 ? 'headlineSmall' : 'titleMedium'}
          style={{ color, fontWeight: '700' }}>
          {heading[2]}
        </Text>,
      );
      return;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      pushParagraph();
      blocks.push(
        <View key={`b-${blocks.length}`} style={styles.markdownBulletRow}>
          <Text style={{ color }}>{'\u2022'}</Text>
          <Text variant="bodyLarge" style={[styles.markdownBulletText, { color, lineHeight: 26 }]}>
            {renderInlineMarkdown(bullet[1], color, mutedColor)}
          </Text>
        </View>,
      );
      return;
    }

    if (!line.trim()) {
      pushParagraph();
      return;
    }

    paragraph.push(line.trim());
  });

  pushParagraph();
  pushCodeBlock();

  return <View style={styles.markdownStack}>{blocks}</View>;
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
    currentDiffs,
    currentPendingPermissions,
    currentPendingQuestions,
    currentSessionId,
    currentTodos,
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
  const [todosExpanded, setTodosExpanded] = useState(true);
  const [visibleTranscriptCount, setVisibleTranscriptCount] = useState(TRANSCRIPT_PAGE_SIZE);
  const [expandedDiffId, setExpandedDiffId] = useState<string | undefined>();

  const status = currentSessionId ? sessionStatuses[currentSessionId] : undefined;
  const running = sendingState.active || (!!status && status.type !== 'idle');
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
  const completedTodos = currentTodos.filter((todo) => todo.status === 'completed').length;
  const pendingTodos = currentTodos.filter((todo) => todo.status !== 'completed' && todo.status !== 'cancelled').length;
  const pendingInteractions = currentPendingPermissions.length + currentPendingQuestions.length;
  const awaitingUserInput = pendingInteractions > 0;
  const displayTranscript = useMemo(
    () => currentTranscript.filter(isDisplayMessage),
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
      if (isDisplayMessage(entry)) {
        continue;
      }

      const label = getActivityLabel(entry);
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
  }, [activeTab, currentTodos, pendingInteractions, running, visibleTranscript]);

  useEffect(() => {
    if (pendingInteractions > 0) {
      setActiveTab('session');
      setTodosExpanded(true);
    }
  }, [pendingInteractions]);

  function handleLoadEarlier() {
    isPaginatingRef.current = true;
    setVisibleTranscriptCount((current) => current + TRANSCRIPT_PAGE_SIZE);
  }

  async function handleSendPrompt(promptOverride?: string) {
    const prompt = (promptOverride ?? draft).trim();
    if ((!prompt && attachments.length === 0) || connection.status !== 'connected') {
      return;
    }

    const sessionId = currentSessionId || (await ensureActiveSession());
    if (!sessionId) {
      return;
    }

    setDraft('');
    await sendPrompt(sessionId, prompt, attachments);
    setAttachments([]);
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
          <Appbar.Action icon="refresh" onPress={() => void refreshCurrentSession()} />
          <Appbar.Action icon="plus" onPress={() => void handleNewSession()} disabled={isCreatingSession || connection.status !== 'connected'} />
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

        {activeTab === 'session' ? visibleTranscript.map((entry) => <TranscriptMessage key={entry.id} entry={entry} />) : null}

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
        {(pendingTodos > 0 || pendingInteractions > 0) ? (
          <TodoPanel
            completedCount={completedTodos}
            expanded={todosExpanded}
            onToggle={() => setTodosExpanded((current) => !current)}
            pendingCount={pendingTodos}
            pendingInteractions={pendingInteractions}
            todos={currentTodos}
          />
        ) : null}

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

        <View style={[styles.inputShell, { borderColor: palette.border, backgroundColor: palette.background }]}> 
          <View style={styles.composerRow}>
            <TextInput
              mode="flat"
              value={draft}
              onChangeText={setDraft}
              multiline
              placeholder="Ask anything..."
              placeholderTextColor={palette.muted}
              style={[styles.input, { backgroundColor: 'transparent', color: palette.text }]}
              contentStyle={styles.inputContentCompact}
              underlineColor="transparent"
              activeUnderlineColor="transparent"
            />

            <IconButton
              mode="contained"
              icon={running ? 'stop' : 'send'}
              size={20}
              style={styles.composerActionButton}
              loading={isStoppingSession}
              disabled={
                running
                  ? !currentSessionId || isStoppingSession
                  : ((!draft.trim() && attachments.length === 0) || connection.status !== 'connected' || isCreatingSession)
              }
              onPress={() => {
                if (running) {
                  void handleAbort();
                  return;
                }

                void handleSendPrompt();
              }}
            />
          </View>
        </View>
      </Surface>
    </KeyboardAvoidingView>
  );
}

function MenuControl({
  active,
  children,
  icon,
  iconName,
  label,
  maxWidth,
  onClose,
  onOpen,
}: {
  active: boolean;
  children: ReactNode;
  icon?: (props: { size: number; color: string }) => ReactNode;
  iconName?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  maxWidth?: number;
  onClose: () => void;
  onOpen: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const anchor = (
    <ControlButton
      active={active || visible}
      icon={icon}
      iconName={iconName}
      maxWidth={maxWidth}
      onPress={() => {
        setVisible(true);
        onOpen();
      }}>
      {label}
    </ControlButton>
  );

  if (!visible) {
    return anchor;
  }

  return (
    <Menu
      visible={visible}
      onDismiss={() => {
        setVisible(false);
        onClose();
      }}
      anchor={anchor}>
      {children}
    </Menu>
  );
}

function ControlButton({
  active = false,
  children,
  icon,
  iconName,
  iconOnly = false,
  loading = false,
  maxWidth,
  onPress,
}: {
  active?: boolean;
  children: string;
  icon?: (props: { size: number; color: string }) => ReactNode;
  iconName?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  iconOnly?: boolean;
  loading?: boolean;
  maxWidth?: number;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const textColor = active ? palette.tint : palette.text;
  const borderColor = active ? 'transparent' : palette.border;
  const backgroundColor = active ? `${palette.tint}18` : palette.surface;

  return (
    <TouchableRipple
      onPress={onPress}
      borderless={false}
      style={[
        styles.controlButton,
        iconOnly ? styles.controlButtonIconOnly : styles.controlButtonText,
        !iconOnly && maxWidth ? { maxWidth } : null,
        { borderColor, backgroundColor },
      ]}>
      <View style={[styles.controlButtonInner, iconOnly && styles.controlButtonInnerIconOnly]}>
        {loading ? <ActivityIndicator size={16} color={textColor} /> : null}
        {!loading && icon ? icon({ size: 16, color: textColor }) : null}
        {!loading && !icon && iconName ? <MaterialCommunityIcons name={iconName} size={16} color={textColor} /> : null}
        {!iconOnly ? (
          <Text numberOfLines={1} ellipsizeMode="tail" variant="labelLarge" style={[styles.controlButtonLabel, { color: textColor }]}>
            {children}
          </Text>
        ) : null}
      </View>
    </TouchableRipple>
  );
}

function TopTab({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <TouchableRipple style={styles.topTab} onPress={onPress}>
      <View style={[styles.topTabInner, active && { borderBottomColor: palette.tint, borderBottomWidth: 2 }]}> 
        <Text variant="titleMedium" style={{ color: active ? palette.text : palette.muted, fontWeight: active ? '700' : '500' }}>{label}</Text>
      </View>
    </TouchableRipple>
  );
}

function TodoPanel({
  completedCount,
  expanded,
  onToggle,
  pendingCount,
  pendingInteractions,
  todos,
}: {
  completedCount: number;
  expanded: boolean;
  onToggle: () => void;
  pendingCount: number;
  pendingInteractions: number;
  todos: Todo[];
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const totalItems = todos.length + pendingInteractions;
  const showTodos = pendingInteractions === 0;
  const titleText = pendingInteractions > 0
    ? 'Waiting for your input'
    : `${completedCount} of ${Math.max(totalItems, completedCount)} items completed`;
  const summaryText = pendingInteractions > 0
    ? `${pendingInteractions} response${pendingInteractions === 1 ? '' : 's'} waiting here`
    : pendingCount > 0
      ? `${pendingCount} still in progress`
      : 'Everything is wrapped up';

  return (
    <Card mode="contained" style={[styles.todoCard, { backgroundColor: palette.background }]}> 
      <TouchableRipple onPress={onToggle}>
        <Card.Content style={styles.todoCardContent}>
          <View style={styles.todoHeader}>
            <View style={styles.todoHeaderText}>
              <Text variant="titleMedium" style={{ color: palette.text }}>{titleText}</Text>
              <Text variant="bodySmall" style={{ color: palette.muted }}>{summaryText}</Text>
            </View>
            <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={palette.muted} />
          </View>
          {expanded ? (
            <View style={styles.todoList}>
              {pendingInteractions > 0 ? (
                <Text variant="bodySmall" style={{ color: palette.muted }}>
                  Review the response card in the session feed to continue.
                </Text>
              ) : null}
              {showTodos ? todos.map((todo, index) => (
                <View key={`${todo.content}-${index}`} style={styles.todoRow}>
                  <View style={[styles.todoState, { borderColor: getTodoTone(todo.priority, palette), backgroundColor: todo.status === 'completed' ? getTodoTone(todo.priority, palette) : 'transparent' }]} />
                  <View style={styles.todoTextWrap}>
                    <Text variant="bodyMedium" style={{ color: palette.text }}>{todo.content}</Text>
                    <Text variant="bodySmall" style={{ color: palette.muted }}>{todo.status.replace('_', ' ')} • {todo.priority}</Text>
                  </View>
                </View>
              )) : null}
            </View>
          ) : null}
        </Card.Content>
      </TouchableRipple>
    </Card>
  );
}

function PendingInteractionsCard({
  onPermissionReply,
  onQuestionReject,
  onQuestionSubmit,
  permissions,
  questions,
}: {
  onPermissionReply: (requestId: string, reply: 'once' | 'always' | 'reject') => void;
  onQuestionReject: (requestId: string) => void;
  onQuestionSubmit: (requestId: string, answers: PendingQuestionAnswer[]) => void;
  permissions: PendingPermissionRequest[];
  questions: PendingQuestionRequest[];
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}> 
      <Card.Content style={styles.pendingInteractionsContent}>
        <View style={styles.waitingNoticeHeader}>
          <MaterialCommunityIcons name="message-alert-outline" size={18} color={palette.warning} />
          <Text variant="titleMedium" style={{ color: palette.text }}>Respond to continue</Text>
        </View>
        <Text variant="bodySmall" style={{ color: palette.muted }}>
          OpenCode is waiting for your answer before it can continue.
        </Text>
        {permissions.map((request) => (
          <PermissionRequestCard
            key={request.id}
            request={request}
            onReply={(reply) => onPermissionReply(request.id, reply)}
          />
        ))}
        {questions.map((request) => (
          <QuestionRequestCard
            key={request.id}
            request={request}
            onReject={() => onQuestionReject(request.id)}
            onSubmit={(answers) => onQuestionSubmit(request.id, answers)}
          />
        ))}
      </Card.Content>
    </Card>
  );
}

function SessionDiffCard({ diff, accordionId, expanded }: { diff: FileDiff; accordionId: string; expanded: boolean }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const diffLines = useMemo(() => (expanded ? buildLineDiff(diff.before || '', diff.after || '') : []), [diff.after, diff.before, expanded]);
  const diffBlocks = useMemo(() => (expanded ? buildCollapsedDiffBlocks(diffLines) : []), [diffLines, expanded]);

  return (
    <List.Accordion
      id={accordionId}
      title={diff.file}
      description={`+${diff.additions} / -${diff.deletions}`}
      titleStyle={{ color: palette.text }}
      descriptionStyle={{ color: palette.muted }}
      style={[styles.diffAccordion, { borderColor: palette.border }]}
      theme={{ colors: { background: palette.surface } }}>
      <View style={styles.diffAccordionBody}>
        <Divider style={styles.divider} />
        {expanded ? (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={styles.diffViewer}>
              {diffBlocks.map((block, blockIndex) => {
                if (block.type === 'collapsed') {
                  return (
                    <View key={`${diff.file}-collapsed-${blockIndex}`} style={[styles.diffCollapsedRow, { backgroundColor: palette.background, borderColor: palette.border }]}> 
                      <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}> 
                        ... {block.hiddenCount} unchanged line{block.hiddenCount === 1 ? '' : 's'}
                        {block.startLine && block.endLine ? ` (${block.startLine}-${block.endLine})` : ''}
                      </Text>
                    </View>
                  );
                }

                return block.lines.map((line, index) => {
                  const tone = getDiffPalette(line.kind, palette);
                  return (
                    <View
                      key={`${diff.file}-${blockIndex}-${index}-${line.leftNumber ?? 'x'}-${line.rightNumber ?? 'x'}`}
                      style={[
                        styles.diffLineRow,
                        {
                          backgroundColor: tone.backgroundColor,
                          borderLeftColor: tone.accentColor,
                        },
                      ]}>
                      <Text variant="labelSmall" style={[styles.diffLineNumber, { color: palette.muted }]}> 
                        {line.leftNumber ?? ''}
                      </Text>
                      <Text variant="labelSmall" style={[styles.diffLineNumber, { color: palette.muted }]}> 
                        {line.rightNumber ?? ''}
                      </Text>
                      <Text style={[styles.diffMarker, { color: tone.accentColor || palette.muted }]}> 
                        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                      </Text>
                      <Text variant="bodySmall" style={[styles.code, styles.diffLineText, { color: palette.text }]}> 
                        {line.text || ' '}
                      </Text>
                    </View>
                  );
                });
              })}
            </View>
          </ScrollView>
        ) : (
          <Text variant="bodySmall" style={{ color: palette.muted }}>Expand to load the diff preview.</Text>
        )}
      </View>
    </List.Accordion>
  );
}

function DiffCard({ detail, accordionId, expanded }: { detail: Extract<TranscriptDetail, { kind: 'patch' | 'file' }>; accordionId: string; expanded: boolean }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <List.Accordion
      id={accordionId}
      title={detail.label}
      description={detail.kind === 'patch' ? 'Patch output' : 'File output'}
      titleStyle={{ color: palette.text }}
      descriptionStyle={{ color: palette.muted }}
      style={[styles.diffAccordion, { borderColor: palette.border }]}
      theme={{ colors: { background: palette.surface } }}>
      <View style={styles.diffAccordionBody}>
        <Divider style={styles.divider} />
        {expanded ? (
          <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}>{detail.body}</Text>
        ) : (
          <Text variant="bodySmall" style={{ color: palette.muted }}>Expand to load the patch preview.</Text>
        )}
      </View>
    </List.Accordion>
  );
}

function TranscriptMessage({ entry }: { entry: TranscriptEntry }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isUser = entry.role === 'user';
  const detailSummary = summarizeDetails(entry.details);

  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      <Surface
        style={[
          styles.messageBubble,
          isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant,
          {
            backgroundColor: isUser ? palette.bubbleUser : palette.bubbleAssistant,
            borderColor: isUser ? palette.bubbleUser : palette.border,
          },
        ]}
        elevation={1}>
        <View style={styles.messageMeta}>
          <Text variant="labelMedium" style={{ color: isUser ? palette.onBubbleUser : palette.muted }}>{isUser ? 'You' : 'OpenCode'}</Text>
          <Text variant="labelSmall" style={{ color: isUser ? palette.onBubbleUser : palette.muted, opacity: isUser ? 0.82 : 1 }}>
            {formatTimestamp(entry.createdAt)}
          </Text>
        </View>
        {entry.text ? (
          <MarkdownText
            text={entry.text}
            color={isUser ? palette.onBubbleUser : palette.onBubbleAssistant}
            mutedColor={isUser ? palette.onBubbleUser : palette.muted}
          />
        ) : null}
        {entry.error ? <Text variant="bodyMedium" style={{ color: palette.danger }}>{entry.error}</Text> : null}
        {!isUser && detailSummary.length > 0 ? (
          <View style={styles.summaryRow}>
            {detailSummary.map((item) => (
              <Chip key={item} compact mode="flat" style={[styles.summaryChip, { backgroundColor: palette.background }]}>
                {item}
              </Chip>
            ))}
          </View>
        ) : null}
      </Surface>
    </View>
  );
}

function PermissionRequestCard({
  compact = false,
  onReply,
  request,
}: {
  compact?: boolean;
  onReply: (reply: 'once' | 'always' | 'reject') => void;
  request: PendingPermissionRequest;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Card mode="contained" style={[styles.requestCard, compact && styles.requestCardCompact, { backgroundColor: palette.background }]}> 
      <Card.Content style={styles.requestCardContent}>
        <Text variant="labelLarge" style={{ color: palette.warning }}>Permission request</Text>
        <Text variant="titleMedium" style={{ color: palette.text }}>{getPermissionTitle(request)}</Text>
        {request.patterns.length > 0 ? (
          <Text variant="bodySmall" style={{ color: palette.muted }}>{request.patterns.join('\n')}</Text>
        ) : null}
        <View style={styles.requestActionsRow}>
          <Button mode="contained" compact onPress={() => onReply('once')}>Allow once</Button>
          <Button mode="contained-tonal" compact onPress={() => onReply('always')}>Always allow</Button>
          <Button mode="text" compact textColor={palette.danger} onPress={() => onReply('reject')}>Deny</Button>
        </View>
      </Card.Content>
    </Card>
  );
}

function QuestionRequestCard({
  compact = false,
  onReject,
  onSubmit,
  request,
}: {
  compact?: boolean;
  onReject: () => void;
  onSubmit: (answers: PendingQuestionAnswer[]) => void;
  request: PendingQuestionRequest;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [answers, setAnswers] = useState<PendingQuestionAnswer[]>(() => request.questions.map(() => []));
  const [customAnswers, setCustomAnswers] = useState<string[]>(() => request.questions.map(() => ''));

  function toggleOption(questionIndex: number, label: string, multiple?: boolean) {
    setAnswers((current) =>
      current.map((answer, index) => {
        if (index !== questionIndex) {
          return answer;
        }

        if (!multiple) {
          return answer[0] === label ? [] : [label];
        }

        return answer.includes(label) ? answer.filter((item) => item !== label) : [...answer, label];
      }),
    );
  }

  function updateCustomAnswer(questionIndex: number, value: string) {
    setCustomAnswers((current) => current.map((answer, index) => (index === questionIndex ? value : answer)));
  }

  function handleSubmit() {
    const nextAnswers = request.questions.map((question, index) => {
      const trimmedCustom = customAnswers[index]?.trim();
      const selected = answers[index] || [];
      return trimmedCustom && question.custom !== false ? [...selected, trimmedCustom] : selected;
    });

    void onSubmit(nextAnswers);
  }

  const canSubmit = request.questions.every((question, index) => {
    const selectedCount = answers[index]?.length || 0;
    const hasCustom = Boolean(customAnswers[index]?.trim()) && question.custom !== false;
    return selectedCount > 0 || hasCustom;
  });

  return (
    <Card mode="contained" style={[styles.requestCard, compact && styles.requestCardCompact, { backgroundColor: palette.background }]}> 
      <Card.Content style={styles.requestCardContent}>
        <Text variant="labelLarge" style={{ color: palette.tint }}>Question</Text>
        <View style={styles.questionList}>
          {request.questions.map((question, questionIndex) => (
            <View key={`${request.id}-${question.header}-${questionIndex}`} style={styles.questionBlock}>
              <View style={styles.questionHeader}>
                <Text variant="titleMedium" style={{ color: palette.text }}>{question.header}</Text>
                <Text variant="bodySmall" style={{ color: palette.muted }}>{question.multiple ? 'Choose one or more' : 'Choose one'}</Text>
              </View>
              <Text variant="bodyMedium" style={{ color: palette.text }}>{question.question}</Text>
              <View style={styles.questionOptions}>
                {question.options.map((option) => {
                  const selected = answers[questionIndex]?.includes(option.label);
                  return (
                    <Chip
                      key={`${question.header}-${option.label}`}
                      compact
                      mode={selected ? 'flat' : 'outlined'}
                      selected={selected}
                      style={styles.questionChip}
                      onPress={() => toggleOption(questionIndex, option.label, question.multiple)}>
                      {option.label}
                    </Chip>
                  );
                })}
              </View>
              {question.custom !== false ? (
                <TextInput
                  mode="outlined"
                  dense
                  placeholder="Type your answer"
                  value={customAnswers[questionIndex] || ''}
                  onChangeText={(value) => updateCustomAnswer(questionIndex, value)}
                />
              ) : null}
            </View>
          ))}
        </View>
        <View style={styles.requestActionsRow}>
          <Button mode="contained" compact disabled={!canSubmit} onPress={handleSubmit}>Submit</Button>
          <Button mode="text" compact textColor={palette.danger} onPress={onReject}>Reject</Button>
        </View>
      </Card.Content>
    </Card>
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
  todoCard: { borderRadius: 22 },
  todoCardContent: { gap: 12 },
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
  todoHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  todoHeaderText: { flex: 1, gap: 4 },
  todoList: { gap: 12 },
  todoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  todoState: { width: 18, height: 18, borderRadius: 6, borderWidth: 1.5, marginTop: 2 },
  todoTextWrap: { flex: 1, gap: 2 },
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
  composerActionButton: { margin: 0 },
  messageRow: { alignItems: 'stretch' },
  messageRowUser: { alignItems: 'flex-end' },
  messageBubble: { maxWidth: '100%', padding: 16, borderRadius: 22, gap: 12, borderWidth: 1 },
  messageBubbleUser: { maxWidth: '88%' },
  messageBubbleAssistant: { width: '100%' },
  messageMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
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
