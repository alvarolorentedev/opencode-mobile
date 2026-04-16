import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Divider, IconButton, List, Surface, Text, TextInput, TouchableRipple } from 'react-native-paper';

import { MarkdownText } from '@/components/chat/chat-markdown';
import { getDiffPalette, buildLineDiff, buildCollapsedDiffBlocks } from '@/components/chat/chat-diff';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PendingPermissionRequest, PendingQuestionAnswer, PendingQuestionRequest } from '@/lib/opencode/client';
import { formatTimestamp, type TranscriptDetail, type TranscriptEntry } from '@/lib/opencode/format';
import { summarizeTranscriptDetails } from '@/lib/opencode/transcript';
import type { FileDiff } from '@/lib/opencode/types';

function getPermissionTitle(request: PendingPermissionRequest) {
  return request.permission
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function PendingInteractionsCard({
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

export function SessionDiffCard({ diff, accordionId, expanded }: { diff: FileDiff; accordionId: string; expanded: boolean }) {
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

export function DiffCard({ detail, accordionId, expanded }: { detail: Extract<TranscriptDetail, { kind: 'patch' | 'file' }>; accordionId: string; expanded: boolean }) {
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

export function TranscriptMessage({
  canSpeak = false,
  copied = false,
  entry,
  onCopy,
  onToggleSpeak,
  speaking = false,
}: {
  canSpeak?: boolean;
  copied?: boolean;
  entry: TranscriptEntry;
  onCopy: () => void;
  onToggleSpeak: () => void;
  speaking?: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isUser = entry.role === 'user';
  const detailSummary = summarizeTranscriptDetails(entry.details);

  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      <TouchableRipple borderless={false} rippleColor={`${palette.tint}22`} style={styles.messageTouchable} onLongPress={onCopy}>
        <Surface
          style={[
            styles.messageBubble,
            isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant,
            {
              backgroundColor: isUser ? palette.bubbleUser : palette.bubbleAssistant,
              borderColor: copied ? palette.tint : isUser ? palette.bubbleUser : palette.border,
            },
            copied ? styles.messageBubbleCopied : null,
          ]}
          elevation={1}>
          <View style={styles.messageMeta}>
            <Text variant="labelMedium" style={{ color: isUser ? palette.onBubbleUser : palette.muted }}>{isUser ? 'You' : 'OpenCode'}</Text>
            <View style={styles.messageMetaRight}>
              {copied ? (
                <View style={[styles.copiedPill, { backgroundColor: isUser ? `${palette.onBubbleUser}20` : `${palette.tint}18` }]}> 
                  <MaterialCommunityIcons name="check" size={12} color={isUser ? palette.onBubbleUser : palette.tint} />
                  <Text variant="labelSmall" style={{ color: isUser ? palette.onBubbleUser : palette.tint }}>Copied</Text>
                </View>
              ) : null}
              {canSpeak ? (
                <IconButton
                  icon={speaking ? 'stop' : 'volume-high'}
                  size={16}
                  style={styles.messageActionButton}
                  iconColor={palette.muted}
                  onPress={onToggleSpeak}
                />
              ) : null}
              <Text variant="labelSmall" style={{ color: isUser ? palette.onBubbleUser : palette.muted, opacity: isUser ? 0.82 : 1 }}>
                {formatTimestamp(entry.createdAt)}
              </Text>
            </View>
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
      </TouchableRipple>
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
  sectionCard: { borderRadius: 20 },
  pendingInteractionsContent: { gap: 12 },
  waitingNoticeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  diffAccordion: { borderWidth: 1, borderRadius: 18 },
  diffAccordionBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  divider: { marginTop: 4 },
  diffViewer: { minWidth: '100%', gap: 2, paddingVertical: 4 },
  diffCollapsedRow: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  diffLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  diffLineNumber: { width: 36, textAlign: 'right' },
  diffMarker: { width: 14, textAlign: 'center', fontFamily: 'monospace' },
  diffLineText: { flex: 1, minWidth: 220 },
  code: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  messageRow: { alignItems: 'flex-start' },
  messageRowUser: { alignItems: 'flex-end' },
  messageTouchable: { maxWidth: '92%', borderRadius: 24 },
  messageBubble: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  messageBubbleUser: { borderBottomRightRadius: 10 },
  messageBubbleAssistant: { borderBottomLeftRadius: 10 },
  messageBubbleCopied: { shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  messageMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  messageMetaRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  messageActionButton: { margin: 0 },
  copiedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryChip: { alignSelf: 'flex-start' },
  requestCard: { borderRadius: 18 },
  requestCardCompact: { borderRadius: 14 },
  requestCardContent: { gap: 10 },
  requestActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  questionList: { gap: 18 },
  questionBlock: { gap: 10 },
  questionHeader: { gap: 4 },
  questionOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  questionChip: { alignSelf: 'flex-start' },
});
