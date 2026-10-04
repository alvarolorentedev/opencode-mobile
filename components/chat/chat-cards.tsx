import { MaterialCommunityIcons } from '@expo/vector-icons';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Card, Chip, IconButton, Surface, Switch, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextInput } from '@/components/ui/text-input';

import { MarkdownText } from '@/components/chat/chat-markdown';
import { getDiffPalette, buildPatchDiff, buildCollapsedDiffBlocks } from '@/components/chat/chat-diff';
import { useAppTheme } from '@/providers/theme-provider';
import type { PendingPermissionRequest, PendingQuestionAnswer, PendingQuestionPrompt, PendingQuestionRequest } from '@/lib/opencode/client';
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
  permissions,
}: {
  onPermissionReply: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  permissions: PendingPermissionRequest[];
}) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();

  return (
    <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}> 
      <Card.Content style={styles.pendingInteractionsContent}>
        <View style={styles.waitingNoticeHeader}>
          <MaterialCommunityIcons name="message-alert-outline" size={18} color={palette.warning} />
          <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:cards.respondToContinue')}</Text>
        </View>
        <Text variant="bodySmall" style={{ color: palette.muted }}>
          {t('chat:cards.waitingForAnswer')}
        </Text>
        {permissions.map((request) => (
          <PermissionRequestCard
            key={request.id}
            request={request}
            onReply={(reply) => onPermissionReply(request.id, reply)}
          />
        ))}
      </Card.Content>
    </Card>
  );
}

export function QuestionFlow({
  onReject,
  onReply,
  onDismiss,
  request,
  visible,
}: {
  onReject: () => Promise<void>;
  onReply: (answers: PendingQuestionAnswer[]) => Promise<void>;
  onDismiss: () => void;
  request: PendingQuestionRequest;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState<'reply' | 'reject' | undefined>(undefined);
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map((prompt) => {
    if (prompt.type === 'boolean') {
      return [prompt.defaultValue === undefined ? 'false' : String(prompt.defaultValue)];
    }
    if (prompt.defaultValue !== undefined && prompt.options.length > 0) {
      const match = prompt.options.find((option) => option.value === String(prompt.defaultValue) || option.label === String(prompt.defaultValue));
      if (match) {
        return [match.label];
      }
    }
    return [];
  }));
  const [customAnswers, setCustomAnswers] = useState<string[]>(() => request.questions.map((prompt) => (
    prompt.defaultValue !== undefined && prompt.options.length === 0 && prompt.type !== 'boolean' && prompt.type !== 'external'
      ? String(prompt.defaultValue)
      : ''
  )));

  const resolvedAnswers = request.questions.map((prompt, index) => {
    const customAnswer = customAnswers[index].trim();
    if (!customAnswer) {
      return answers[index];
    }
    return prompt.multiple ? [...answers[index], customAnswer] : [customAnswer];
  });

  const answerValuesFor = (prompt: PendingQuestionPrompt, index: number) => resolvedAnswers[index].map((entry) => {
    const match = prompt.options.find((option) => option.label === entry || option.value === entry);
    return match?.value ?? entry;
  });

  const isPromptVisible = (prompt: PendingQuestionPrompt, index: number) => {
    if (!prompt.when || prompt.when.length === 0) {
      return true;
    }
    return prompt.when.every((condition) => {
      const otherIndex = request.questions.findIndex((candidate) => candidate.key === condition.key);
      if (otherIndex === -1 || otherIndex === index) {
        return true;
      }
      const values = answerValuesFor(request.questions[otherIndex], otherIndex);
      const matched = values.some((value) => String(value) === String(condition.value));
      return condition.op === 'neq' ? !matched : matched;
    });
  };

  const canSubmit = request.questions.every((prompt, index) => {
    if (!isPromptVisible(prompt, index)) {
      return true;
    }
    const required = prompt.required ?? prompt.type === undefined;
    return !required || resolvedAnswers[index].length > 0;
  });
  const visibleIndexes = request.questions.map((_, index) => index).filter((index) => isPromptVisible(request.questions[index], index));
  const currentStep = Math.min(step, Math.max(visibleIndexes.length - 1, 0));
  const currentIndex = visibleIndexes[currentStep];
  const currentPrompt = currentIndex === undefined ? undefined : request.questions[currentIndex];
  const currentRequired = currentPrompt ? (currentPrompt.required ?? currentPrompt.type === undefined) : false;
  const canAdvance = !currentRequired || currentIndex === undefined || resolvedAnswers[currentIndex].length > 0;

  const handleReply = () => {
    if (submitting) {
      return;
    }
    setSubmitting('reply');
    setError(undefined);
    void onReply(resolvedAnswers).catch((reason) => setError(reason instanceof Error ? reason.message : t('chat:cards.couldNotSubmitAnswer'))).finally(() => setSubmitting(undefined));
  };

  const handleReject = () => {
    if (submitting) {
      return;
    }
    setSubmitting('reject');
    setError(undefined);
    void onReject().catch((reason) => setError(reason instanceof Error ? reason.message : t('chat:cards.couldNotRejectQuestion'))).finally(() => setSubmitting(undefined));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onDismiss}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.background }} behavior="padding">
        <Appbar.Header statusBarHeight={0} style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }}>
          <Appbar.BackAction accessibilityLabel={t('chat:cards.returnToChat')} onPress={onDismiss} />
          <Appbar.Content title={t('chat:cards.assistantQuestion')} subtitle={t('chat:cards.stepOfTotal', { current: currentStep + 1, total: visibleIndexes.length })} />
        </Appbar.Header>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18 }}>
        <Text variant="labelLarge" style={{ color: palette.warning }}>{t('chat:cards.waitingForAnswerBanner')}</Text>
        <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:cards.questionOfTotal', { current: currentStep + 1, total: visibleIndexes.length })}</Text>
        {request.title ? <Text variant="bodySmall" style={{ color: palette.muted }}>{request.title}</Text> : null}
        {request.questions.map((prompt, questionIndex) => {
          if (questionIndex !== currentIndex) {
            return null;
          }

          const selected = answers[questionIndex];
          const showOptions = prompt.type !== 'boolean' && prompt.type !== 'external' && prompt.options.length > 0;
          const showCustom = prompt.custom !== false && prompt.type !== 'boolean' && prompt.type !== 'external';

          return (
            <View key={`${request.id}-${questionIndex}`} style={styles.questionBlock}>
              <Text variant="titleMedium" style={{ color: palette.text }}>{prompt.header}</Text>
              {prompt.question && prompt.question !== prompt.header ? (
                <Text variant="bodyMedium" style={{ color: palette.text }}>{prompt.question}</Text>
              ) : null}

              {prompt.type === 'boolean' ? (
                <View style={styles.questionBooleanRow}>
                  <Text variant="bodyMedium" style={{ color: palette.text }}>{selected.includes('true') ? t('chat:cards.yes') : t('chat:cards.no')}</Text>
                  <Switch
                    accessibilityLabel={prompt.header}
                    value={selected.includes('true')}
                    onValueChange={(value) => {
                      setAnswers((current) => current.map((answer, index) => index === questionIndex ? [value ? 'true' : 'false'] : answer));
                    }}
                  />
                </View>
              ) : null}

              {prompt.type === 'external' && prompt.url ? (
                <Button mode="outlined" icon="open-in-new" onPress={() => { void Linking.openURL(prompt.url as string).catch(() => undefined); }}>
                  {t('chat:cards.openLink')}
                </Button>
              ) : null}

              {showOptions ? (
                <View style={styles.questionOptions}>
                  {prompt.options.map((option) => {
                    const isSelected = selected.includes(option.label);
                    return (
                      <View key={option.label} style={{ width: '100%', gap: 4 }}>
                      <Button
                        accessibilityLabel={[option.label, option.description].filter(Boolean).join('. ')}
                        accessibilityState={{ selected: isSelected }}
                        style={{ width: '100%' }}
                        contentStyle={{ justifyContent: 'flex-start' }}
                        labelStyle={{ flexShrink: 1 }}
                        mode={isSelected ? 'contained-tonal' : 'outlined'}
                        onPress={() => {
                          setAnswers((current) => current.map((answer, index) => {
                            if (index !== questionIndex) return answer;
                            if (!prompt.multiple) return [option.label];
                            return isSelected ? answer.filter((label) => label !== option.label) : [...answer, option.label];
                          }));
                          if (!prompt.multiple) {
                            setCustomAnswers((current) => current.map((answer, index) => index === questionIndex ? '' : answer));
                          }
                        }}>
                        {option.label}
                      </Button>
                      {option.description ? <Text variant="bodySmall" style={{ color: palette.muted, paddingHorizontal: 12 }}>{option.description}</Text> : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}


              {showCustom ? (
                <TextInput
                  dense
                  mode="outlined"
                  label={prompt.placeholder || t('chat:cards.customAnswer')}
                  keyboardType={prompt.type === 'number' || prompt.type === 'integer' ? 'numeric' : 'default'}
                  value={customAnswers[questionIndex]}
                  onChangeText={(value) => {
                    setCustomAnswers((current) => current.map((answer, index) => index === questionIndex ? value : answer));
                    if (!prompt.multiple && value) {
                      setAnswers((current) => current.map((answer, index) => index === questionIndex ? [] : answer));
                    }
                  }}
                />
              ) : null}
            </View>
          );
        })}
        {error ? <Text style={{ color: palette.danger }}>{error}</Text> : null}
        </ScrollView>
        <View style={[styles.questionFooter, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button mode="outlined" disabled={currentStep === 0 || Boolean(submitting)} onPress={() => setStep((value) => Math.max(0, value - 1))}>{t('common:actions.back')}</Button>
          {currentStep < visibleIndexes.length - 1 ? <Button mode="contained" disabled={!canAdvance || Boolean(submitting)} onPress={() => setStep((value) => value + 1)}>{t('common:actions.next')}</Button> : <Button
            mode="contained"
            disabled={!canSubmit || Boolean(submitting)}
            loading={submitting === 'reply'}
            onPress={handleReply}>
            {t('chat:cards.submitAnswer')}
          </Button>}
          <Button mode="text" textColor={palette.danger} disabled={Boolean(submitting)} loading={submitting === 'reject'} onPress={handleReject}>{t('chat:cards.reject')}</Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SessionDiffCard({ diff, expanded, onPress }: { diff: FileDiff; expanded: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const diffLines = useMemo(() => (expanded ? buildPatchDiff(diff.patch || '') : []), [diff.patch, expanded]);
  const diffBlocks = useMemo(() => (expanded ? buildCollapsedDiffBlocks(diffLines) : []), [diffLines, expanded]);

  return (
    <View style={[styles.diffAccordion, { borderColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={onPress} style={[styles.diffFileRow, { backgroundColor: palette.surface }]}>
        <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={palette.muted} />
        <Text variant="labelLarge" numberOfLines={1} ellipsizeMode="middle" style={[styles.diffFileName, { color: palette.text }]}>{diff.file || t('chat:cards.unknownFile')}</Text>
        <Text variant="labelMedium" style={{ color: palette.success }}>+{diff.additions}</Text>
        <Text variant="labelMedium" style={{ color: palette.danger }}>−{diff.deletions}</Text>
      </Pressable>
      <View style={styles.diffAccordionBody}>
        {expanded ? (
          <View style={styles.diffViewer}>
            {diffBlocks.length === 0 ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:cards.noLineChanges')}</Text> : diffBlocks.map((block, blockIndex) => {
              if (block.type === 'collapsed') {
                return (
                  <View key={`${diff.file}-collapsed-${blockIndex}`} style={[styles.diffCollapsedRow, { backgroundColor: palette.background, borderColor: palette.border }]}>
                    <Text variant="bodySmall" style={[styles.code, { color: palette.muted }]}>
                      {t('chat:cards.hiddenLines', { count: block.hiddenCount })}
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
                      {line.rightNumber ?? line.leftNumber ?? ''}
                    </Text>
                    <Text style={[styles.diffMarker, { color: tone.accentColor || palette.muted }]}>
                      {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                    </Text>
                    <Text selectable variant="bodySmall" style={[styles.code, styles.diffLineText, { color: palette.text }]}>
                      {line.text || ' '}
                    </Text>
                  </View>
                );
              });
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function DiffCard({ detail, expanded, onPress }: { detail: Extract<TranscriptDetail, { kind: 'patch' }>; expanded: boolean; onPress: () => void }) {
  const { palette } = useAppTheme();

  return (
    <View style={[styles.diffAccordion, { borderColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={onPress} style={[styles.diffFileRow, { backgroundColor: palette.surface }]}>
        <MaterialCommunityIcons name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={palette.muted} />
        <Text variant="labelLarge" numberOfLines={1} ellipsizeMode="middle" style={[styles.diffFileName, { color: palette.text }]}>{detail.label}</Text>
      </Pressable>
      {expanded ? <Text selectable variant="bodySmall" style={[styles.code, styles.diffFallback, { color: palette.muted }]}>{detail.body}</Text> : null}
    </View>
  );
}

type TranscriptMessageProps = {
  canSpeak?: boolean;
  copied?: boolean;
  entry: TranscriptEntry;
  flat?: boolean;
  fontSize: number;
  onCopy: () => void;
  onReviewChanges?: (messageId: string) => void;
  onFork?: () => void;
  onRevert?: () => void;
  onToggleSpeak: () => void;
  slim?: boolean;
  speaking?: boolean;
};

function TranscriptMessageImpl({
  canSpeak = false,
  copied = false,
  entry,
  flat = false,
  fontSize,
  onCopy,
  onReviewChanges,
  onFork,
  onRevert,
  onToggleSpeak,
  slim = false,
  speaking = false,
}: TranscriptMessageProps) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const isUser = entry.role === 'user';
  const patchSummary = t('chat:cards.updatedPatches', { count: entry.details.filter((detail) => detail.kind === 'patch').length });
  const detailSummary = summarizeTranscriptDetails(entry.details, { patches: (count) => t('chat:cards.updatedPatches', { count }), files: (count) => t('chat:cards.fileCount', { count }) });
  const textColor = flat ? palette.text : isUser ? palette.onBubbleUser : palette.onBubbleAssistant;
  const metaColor = flat ? palette.muted : isUser ? palette.onBubbleUser : palette.muted;
  const accentColor = flat ? palette.tint : isUser ? palette.onBubbleUser : palette.tint;
  const slimSpacing = slim ? (flat ? { paddingVertical: 2, gap: 4 } : { borderRadius: 14, gap: 6, paddingHorizontal: 10, paddingVertical: 8 }) : null;

  return (
    <View style={[styles.messageRow, flat ? styles.messageRowFlat : isUser && styles.messageRowUser]}>
      <View onTouchEnd={Keyboard.dismiss} style={styles.messageTouchable}>
        <Surface
          style={[
            styles.messageBubble,
            flat ? styles.messageFlat : isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant,
            flat
              ? null
              : {
                  backgroundColor: isUser ? palette.bubbleUser : palette.bubbleAssistant,
                  borderColor: copied ? palette.tint : isUser ? palette.bubbleUser : palette.border,
                },
            slimSpacing,
            copied && !flat ? styles.messageBubbleCopied : null,
          ]}
          elevation={flat ? 0 : 1}>
          <View style={[styles.messageMeta, slim && { gap: 8 }]}>
            <Text variant="labelMedium" style={{ color: metaColor }}>{isUser ? t('chat:cards.you') : t('chat:cards.opencode')}</Text>
            <View style={styles.messageMetaRight}>
              <IconButton
                accessibilityLabel={t('common:actions.copy')}
                icon="content-copy"
                size={slim ? 14 : 16}
                style={styles.messageActionButton}
                iconColor={palette.muted}
                onPress={onCopy}
              />
              {copied ? (
                <View style={[styles.copiedPill, { backgroundColor: flat ? `${palette.tint}18` : isUser ? `${palette.onBubbleUser}20` : `${palette.tint}18` }]}> 
                  <MaterialCommunityIcons name="check" size={12} color={accentColor} />
                  <Text variant="labelSmall" style={{ color: accentColor }}>{t('chat:cards.copied')}</Text>
                </View>
              ) : null}
              {canSpeak ? (
                <IconButton
                  accessibilityLabel={t(speaking ? 'chat:cards.stopReadAloud' : 'chat:cards.readAloud')}
                  icon={speaking ? 'stop' : 'volume-high'}
                  size={slim ? 14 : 16}
                  style={styles.messageActionButton}
                  iconColor={palette.muted}
                  onPress={onToggleSpeak}
                />
              ) : null}
              {onFork ? <IconButton accessibilityLabel={t('chat:cards.fork')} icon="source-fork" size={slim ? 14 : 16} style={styles.messageActionButton} iconColor={palette.muted} onPress={onFork} /> : null}
              {onRevert ? <IconButton accessibilityLabel={t('chat:cards.revert')} icon="undo-variant" size={slim ? 14 : 16} style={styles.messageActionButton} iconColor={palette.muted} onPress={onRevert} /> : null}
              <Text variant="labelSmall" style={{ color: metaColor, opacity: isUser && !flat ? 0.82 : 1 }}>
                {formatTimestamp(entry.createdAt)}
              </Text>
            </View>
          </View>
          {entry.text ? (
            <MarkdownText
              text={entry.text}
              color={textColor}
              fontSize={fontSize}
              mutedColor={flat ? palette.muted : isUser ? palette.onBubbleUser : palette.muted}
            />
          ) : null}
          {entry.error ? <Text variant="bodyMedium" style={{ color: palette.danger }}>{entry.error}</Text> : null}
          {!isUser && detailSummary.length > 0 ? (
            <View style={styles.summaryRow}>
              {detailSummary.map((item) => (
                <Chip key={item} onPress={item === patchSummary && onReviewChanges ? () => onReviewChanges(entry.id) : undefined} accessibilityLabel={item === patchSummary ? `${item}. ${t('chat:cards.reviewChanges')}` : item} compact mode="flat" style={[styles.summaryChip, { backgroundColor: palette.background }]}>
                  {item}
                </Chip>
              ))}
            </View>
          ) : null}
        </Surface>
      </View>
    </View>
  );
}

// Re-render only when entry identity or visible state changes.
// Review actions also depend on the current session's parent-message mapping.
function areTranscriptMessagePropsEqual(prev: TranscriptMessageProps, next: TranscriptMessageProps) {
  return (
    prev.entry === next.entry &&
    prev.fontSize === next.fontSize &&
    prev.flat === next.flat &&
    prev.slim === next.slim &&
    prev.copied === next.copied &&
    prev.speaking === next.speaking &&
    prev.canSpeak === next.canSpeak &&
    prev.onReviewChanges === next.onReviewChanges
  );
}

export const TranscriptMessage = memo(TranscriptMessageImpl, areTranscriptMessagePropsEqual);

function PermissionRequestCard({
  compact = false,
  onReply,
  request,
}: {
  compact?: boolean;
  onReply: (reply: 'once' | 'always' | 'reject') => Promise<void>;
  request: PendingPermissionRequest;
}) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const [submitting, setSubmitting] = useState<'once' | 'always' | 'reject' | undefined>(undefined);

  const handleReply = (reply: 'once' | 'always' | 'reject') => {
    if (submitting) {
      return;
    }
    setSubmitting(reply);
    void onReply(reply).catch(() => undefined).finally(() => setSubmitting(undefined));
  };

  return (
    <Card mode="contained" style={[styles.requestCard, compact && styles.requestCardCompact, { backgroundColor: palette.background }]}> 
      <Card.Content style={styles.requestCardContent}>
        <Text variant="labelLarge" style={{ color: palette.warning }}>{t('chat:cards.permissionRequest')}</Text>
        <Text variant="titleMedium" style={{ color: palette.text }}>{getPermissionTitle(request)}</Text>
        {request.patterns.length > 0 ? (
          <Text variant="bodySmall" style={{ color: palette.muted }}>{request.patterns.join('\n')}</Text>
        ) : null}
        <Text variant="labelMedium" style={{ color: palette.text }}>{t('chat:cards.futureApprovalScope')}</Text>
        <Text variant="bodySmall" style={{ color: palette.muted }}>{request.always.length ? request.always.join('\n') : t('chat:cards.unspecifiedScope')}</Text>
        <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:cards.serverRuleDuration')}</Text>
        <View style={styles.requestActionsRow}>
          <Button mode="contained" compact disabled={Boolean(submitting)} loading={submitting === 'once'} onPress={() => handleReply('once')}>{t('chat:cards.allowOnce')}</Button>
          <Button mode="contained-tonal" compact disabled={Boolean(submitting)} loading={submitting === 'always'} onPress={() => handleReply('always')}>{t('chat:cards.alwaysAllow')}</Button>
          <Button mode="text" compact textColor={palette.danger} disabled={Boolean(submitting)} loading={submitting === 'reject'} onPress={() => handleReply('reject')}>{t('chat:cards.deny')}</Button>
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionCard: { borderRadius: 20 },
  pendingInteractionsContent: { gap: 12 },
  waitingNoticeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  diffAccordion: { borderBottomWidth: 1 },
  diffFileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
  diffFileName: { flex: 1, minWidth: 0, fontWeight: '700' },
  diffFallback: { padding: 12 },
  diffAccordionBody: { paddingBottom: 0 },
  diffViewer: { width: '100%', paddingVertical: 4 },
  diffCollapsedRow: { borderRadius: 8, marginHorizontal: 8, marginVertical: 4, paddingHorizontal: 10, paddingVertical: 8 },
  diffLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  diffLineNumber: { width: 30, textAlign: 'right' },
  diffMarker: { width: 12, textAlign: 'center', fontFamily: 'monospace' },
  diffLineText: { flex: 1, minWidth: 0 },
  code: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  messageRow: { alignItems: 'flex-start' },
  messageRowUser: { alignItems: 'flex-end' },
  messageRowFlat: { alignItems: 'stretch' },
  messageTouchable: { alignSelf: 'stretch', borderRadius: 24 },
  messageBubble: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    alignSelf: 'stretch',
    minWidth: 0,
    overflow: 'hidden',
  },
  messageFlat: {
    borderRadius: 0,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 4,
    gap: 6,
    alignSelf: 'stretch',
    minWidth: 0,
    backgroundColor: 'transparent',
  },
  messageBubbleUser: { borderBottomRightRadius: 10, marginLeft: '8%', marginRight: 8 },
  messageBubbleAssistant: { borderBottomLeftRadius: 10, marginRight: '8%', marginLeft: 8 },
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
  questionFooter: { borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 12 },
  questionBlock: { gap: 8 },
  questionBooleanRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  questionOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
