import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Linking, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Switch, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextInput } from '@/components/ui/text-input';
import type { PendingQuestionAnswer, PendingQuestionPrompt, PendingQuestionRequest } from '@/lib/opencode/client';
import { usePalette } from '@/hooks/use-palette';

export function QuestionFlow({
  onReject,
  onReply,
  onDismiss,
  request,
  sourceTitle,
  visible,
}: {
  onReject: () => Promise<void>;
  onReply: (answers: PendingQuestionAnswer[]) => Promise<void>;
  onDismiss: () => void;
  request: PendingQuestionRequest;
  sourceTitle?: string;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
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
        {sourceTitle ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:cards.requestedBy', { name: sourceTitle })}</Text> : null}
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

const styles = StyleSheet.create({
  questionFooter: { borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 12 },
  questionBlock: { gap: 8 },
  questionBooleanRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  questionOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
