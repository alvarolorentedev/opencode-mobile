import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import type { FileDiff, Todo } from '@opencode-ai/sdk/client';
import {
  ActivityIndicator,
  Appbar,
  Button,
  Card,
  Chip,
  Divider,
  Menu,
  Surface,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  formatTimestamp,
  getSessionSubtitle,
  type TranscriptDetail,
  type TranscriptEntry,
} from '@/lib/opencode/format';
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

function clipBlock(value: string, limit = 18) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'No content';
  }

  const lines = trimmed.split('\n');
  return lines.length <= limit ? trimmed : `${lines.slice(0, limit).join('\n')}\n...`;
}

function getDetailKindLabel(detail: TranscriptDetail) {
  switch (detail.kind) {
    case 'reasoning':
      return 'Thinking';
    case 'tool':
      return 'Tool';
    case 'patch':
      return 'Patch';
    case 'file':
      return 'File';
    case 'subtask':
      return 'Task';
    case 'step':
      return 'Step';
    case 'agent':
      return 'Agent';
    case 'retry':
      return 'Retry';
    case 'compaction':
      return 'Context';
    default:
      return 'Detail';
  }
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
    activeProject,
    activeSession,
    availableAgents,
    availableModels,
    chatPreferences,
    connection,
    createSession,
    currentDiffs,
    currentSessionId,
    currentTodos,
    currentTranscript,
    ensureActiveSession,
    isBootstrappingChat,
    isRefreshingDiffs,
    isRefreshingMessages,
    openSession,
    refreshCurrentSession,
    sendPrompt,
    sendingState,
    sessionStatuses,
    setAutoApprove,
    updateChatPreferences,
    abortSession,
  } = useOpencode();

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<{ uri: string; mime?: string; filename?: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'session' | 'changes'>('session');
  const [menu, setMenu] = useState<'mode' | 'model' | 'reasoning' | undefined>();
  const [isUpdatingAutoApprove, setIsUpdatingAutoApprove] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [todosExpanded, setTodosExpanded] = useState(true);
  const [visibleTranscriptCount, setVisibleTranscriptCount] = useState(TRANSCRIPT_PAGE_SIZE);

  const status = currentSessionId ? sessionStatuses[currentSessionId] : undefined;
  const running = sendingState.active || (!!status && status.type !== 'idle');
  const visibleModels = useMemo(
    () => availableModels.filter((model) => model.providerID === chatPreferences.providerId),
    [availableModels, chatPreferences.providerId],
  );
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
  const visibleTranscript = useMemo(
    () => currentTranscript.slice(Math.max(0, currentTranscript.length - visibleTranscriptCount)),
    [currentTranscript, visibleTranscriptCount],
  );
  const hasMoreTranscript = visibleTranscript.length < currentTranscript.length;

  useEffect(() => {
    setVisibleTranscriptCount(TRANSCRIPT_PAGE_SIZE);
  }, [currentSessionId]);

  useEffect(() => {
    if (currentTranscript.length <= visibleTranscriptCount) {
      return;
    }

    const latestVisibleId = visibleTranscript[0]?.id;
    const nextWindow = currentTranscript.slice(Math.max(0, currentTranscript.length - visibleTranscriptCount));
    if (latestVisibleId && !nextWindow.some((entry) => entry.id === latestVisibleId)) {
      setVisibleTranscriptCount((current) => current + TRANSCRIPT_PAGE_SIZE);
    }
  }, [currentTranscript, visibleTranscript, visibleTranscriptCount]);

  useEffect(() => {
    if (isPaginatingRef.current) {
      isPaginatingRef.current = false;
      return;
    }

    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: visibleTranscript.length > 1 });
    }, 80);

    return () => clearTimeout(timer);
  }, [activeTab, currentTodos, running, visibleTranscript]);

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
        <Appbar.Content
          title={activeSession?.title || 'OpenCode'}
          subtitle={activeSession ? getSessionSubtitle(activeSession) : activeProject?.label || 'Chat'}
          titleStyle={styles.headerTitle}
        />
        <Appbar.Action icon="refresh" onPress={() => void refreshCurrentSession()} />
        <Appbar.Action icon="plus" onPress={() => void handleNewSession()} disabled={isCreatingSession || connection.status !== 'connected'} />
      </Appbar.Header>

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

        {activeTab === 'session' && currentTranscript.length === 0 ? (
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

            {currentDiffs.map((diff) => <SessionDiffCard key={diff.file} diff={diff} />)}
            {currentDiffs.length === 0 ? diffDetails.map((detail) => <DiffCard key={detail.id} detail={detail} />) : null}
          </View>
        ) : null}

        {activeTab === 'session' && running && currentTranscript.length > 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={palette.tint} />
            <Text style={{ color: palette.muted }}>OpenCode is working through the current step...</Text>
          </View>
        ) : null}
      </ScrollView>

      <Surface
        style={[styles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}
        elevation={4}>
        {currentTodos.length > 0 && pendingTodos > 0 ? (
          <TodoPanel
            completedCount={completedTodos}
            expanded={todosExpanded}
            onToggle={() => setTodosExpanded((current) => !current)}
            pendingCount={pendingTodos}
            todos={currentTodos}
          />
        ) : null}

        <View style={styles.controlsRow}>
          <MenuControl
            active={menu === 'mode'}
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
            label={getModelLabel(visibleModels, chatPreferences.modelId)}
            onClose={() => setMenu(undefined)}
            onOpen={() => setMenu('model')}>
            {visibleModels.map((model) => (
              <Menu.Item
                key={model.id}
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
          <Button
            mode={chatPreferences.autoApprove ? 'contained-tonal' : 'outlined'}
            compact
            loading={isUpdatingAutoApprove}
            onPress={() => {
              setIsUpdatingAutoApprove(true);
              void setAutoApprove(!chatPreferences.autoApprove).finally(() => setIsUpdatingAutoApprove(false));
            }}>
            {chatPreferences.autoApprove ? 'Auto' : 'Ask first'}
          </Button>
          <Button mode="outlined" compact icon="paperclip" onPress={() => void handleAttach()}>
            Files
          </Button>
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
          <TextInput
            mode="flat"
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="Ask anything..."
            placeholderTextColor={palette.muted}
            style={[styles.input, { backgroundColor: 'transparent' }]}
            contentStyle={styles.inputContentCompact}
            underlineColor="transparent"
            activeUnderlineColor="transparent"
          />

          <View style={styles.composerFooter}>
            <Text variant="bodySmall" style={{ color: palette.muted }}>
              {running ? 'Streaming updates' : isBootstrappingChat ? 'Preparing session' : 'Ready'}
            </Text>
            <View style={styles.composerActions}>
              {running ? (
                <Button mode="outlined" onPress={() => void handleAbort()} loading={isStoppingSession}>
                  Stop
                </Button>
              ) : null}
              <Button
                mode="contained"
                disabled={(!draft.trim() && attachments.length === 0) || connection.status !== 'connected' || isCreatingSession}
                onPress={() => void handleSendPrompt()}>
                Send
              </Button>
            </View>
          </View>
        </View>
      </Surface>
    </KeyboardAvoidingView>
  );
}

function MenuControl({
  active,
  children,
  label,
  onClose,
  onOpen,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClose: () => void;
  onOpen: () => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <Menu
      visible={visible}
      onDismiss={() => {
        setVisible(false);
        onClose();
      }}
      anchor={
        <Button
          mode={active || visible ? 'contained-tonal' : 'outlined'}
          compact
          onPress={() => {
            setVisible(true);
            onOpen();
          }}>
          {label}
        </Button>
      }>
      {children}
    </Menu>
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
  todos,
}: {
  completedCount: number;
  expanded: boolean;
  onToggle: () => void;
  pendingCount: number;
  todos: Todo[];
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Card mode="contained" style={[styles.todoCard, { backgroundColor: palette.background }]}> 
      <TouchableRipple onPress={onToggle}>
        <Card.Content style={styles.todoCardContent}>
          <View style={styles.todoHeader}>
            <View style={styles.todoHeaderText}>
              <Text variant="titleMedium" style={{ color: palette.text }}>{completedCount} of {todos.length} todos completed</Text>
              <Text variant="bodySmall" style={{ color: palette.muted }}>{pendingCount > 0 ? `${pendingCount} still in progress` : 'Everything is wrapped up'}</Text>
            </View>
            <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={palette.muted} />
          </View>
          {expanded ? (
            <View style={styles.todoList}>
              {todos.map((todo, index) => (
                <View key={`${todo.content}-${index}`} style={styles.todoRow}>
                  <View style={[styles.todoState, { borderColor: getTodoTone(todo.priority, palette), backgroundColor: todo.status === 'completed' ? getTodoTone(todo.priority, palette) : 'transparent' }]} />
                  <View style={styles.todoTextWrap}>
                    <Text variant="bodyMedium" style={{ color: palette.text }}>{todo.content}</Text>
                    <Text variant="bodySmall" style={{ color: palette.muted }}>{todo.status.replace('_', ' ')} • {todo.priority}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </Card.Content>
      </TouchableRipple>
    </Card>
  );
}

function SessionDiffCard({ diff }: { diff: FileDiff }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [open, setOpen] = useState(false);

  return (
    <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}> 
      <TouchableRipple onPress={() => setOpen((current) => !current)}>
        <Card.Content style={styles.diffContent}>
          <View style={styles.diffHeader}>
            <Text variant="titleMedium" style={{ color: palette.text }}>{diff.file}</Text>
            <Text variant="bodySmall" style={{ color: palette.muted }}>+{diff.additions} / -{diff.deletions}</Text>
          </View>
          {open ? (
            <>
              <Divider style={styles.divider} />
              <Text variant="labelMedium" style={{ color: palette.muted }}>Before</Text>
              <Text variant="bodySmall" style={[styles.code, { color: palette.text }]}>{clipBlock(diff.before)}</Text>
              <Text variant="labelMedium" style={{ color: palette.muted }}>After</Text>
              <Text variant="bodySmall" style={[styles.code, { color: palette.text }]}>{clipBlock(diff.after)}</Text>
            </>
          ) : null}
        </Card.Content>
      </TouchableRipple>
    </Card>
  );
}

function DiffCard({ detail }: { detail: Extract<TranscriptDetail, { kind: 'patch' | 'file' }> }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}> 
      <Card.Content style={styles.diffContent}>
        <Text variant="titleMedium" style={{ color: palette.text }}>{detail.label}</Text>
        <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}>{detail.body}</Text>
      </Card.Content>
    </Card>
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

function DetailCard({ detail }: { detail: TranscriptDetail }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const startsOpen = detail.kind === 'tool' && detail.status === 'running';
  const [open, setOpen] = useState(startsOpen);

  return (
    <Surface style={[styles.detailCard, { backgroundColor: palette.background, borderColor: palette.border }]} elevation={0}>
      <TouchableRipple borderless onPress={() => setOpen((current) => !current)}>
        <View style={styles.detailContent}>
          <View style={styles.detailHeader}>
            <View style={styles.detailTitleWrap}>
              <Text variant="labelLarge" style={{ color: palette.muted }}>{getDetailKindLabel(detail)}</Text>
              <Text variant="bodyLarge" style={{ color: palette.text }}>{detail.label}</Text>
            </View>
            {'status' in detail && detail.status ? (
              <Chip compact mode="flat">{detail.status}</Chip>
            ) : (
              <Text variant="labelMedium" style={{ color: palette.tint }}>{open ? 'Hide' : 'Show'}</Text>
            )}
          </View>
          {open ? <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}>{detail.body}</Text> : null}
        </View>
      </TouchableRipple>
    </Surface>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { elevation: 0 },
  headerTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1 },
  topTab: { flex: 1 },
  topTabInner: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 12, gap: 12, paddingBottom: 20 },
  noticeCard: { borderRadius: 20 },
  emptyCard: { borderRadius: 22 },
  emptyContent: { gap: 14 },
  emptyTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  promptStack: { gap: 10 },
  promptCard: { borderWidth: 1, borderRadius: 18 },
  promptCardInner: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14 },
  sectionStack: { gap: 12 },
  sectionCard: { borderRadius: 18 },
  sectionHeaderCard: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
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
  todoHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  todoHeaderText: { flex: 1, gap: 4 },
  todoList: { gap: 12 },
  todoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  todoState: { width: 18, height: 18, borderRadius: 6, borderWidth: 1.5, marginTop: 2 },
  todoTextWrap: { flex: 1, gap: 2 },
  inputShell: { borderWidth: 1, borderRadius: 24, padding: 14, gap: 12 },
  input: { minHeight: 92, maxHeight: 180, fontSize: 18 },
  inputContentCompact: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 6, fontFamily: Fonts.sans },
  controlsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 2 },
  attachmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 2 },
  attachmentChip: { alignSelf: 'flex-start' },
  composerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  composerActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
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
  diffContent: { gap: 8 },
  diffHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  code: { fontFamily: Platform.select({ ios: Fonts.mono, default: 'monospace' }) },
  divider: { marginVertical: 4 },
});
