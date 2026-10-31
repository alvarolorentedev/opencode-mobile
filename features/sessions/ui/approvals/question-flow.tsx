import { cn } from '@/shared/ui/cn';
import { ModalSurface } from '@/shared/ui/portal';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { Text } from '@/shared/ui/text';
import { Switch } from '@/shared/ui/switch';
import { TextField } from '@/shared/ui/text-field';
import { Spinner } from '@/shared/ui/spinner';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Linking, ScrollView, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PendingQuestionAnswer, PendingQuestionPrompt, PendingQuestionRequest } from '@/shared/protocol/opencode/client';
import { usePalette } from '@/shared/ui/theme/use-palette';

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
    <ModalSurface accessibilityLabel={t('chat:cards.assistantQuestion')} visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onDismiss}>
      <KeyboardAvoidingView className={cn("flex-1 bg-background")} behavior="padding">
        <ScreenHeader style={{ backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }} safeArea={false}><Button accessibilityLabel={t('chat:cards.returnToChat')} onPress={onDismiss} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} /></Button><HeaderTitle title={t('chat:cards.assistantQuestion')} subtitle={t('chat:cards.stepOfTotal', { current: currentStep + 1, total: visibleIndexes.length })} maxFontSizeMultiplier={1.5}></HeaderTitle></ScreenHeader>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18 }}>
        <Text className={cn("text-warning")} variant="description">{t('chat:cards.waitingForAnswerBanner')}</Text>
        <Text className={cn("text-muted-foreground")} variant="label">{t('chat:cards.questionOfTotal', { current: currentStep + 1, total: visibleIndexes.length })}</Text>
        {sourceTitle ? <Text className={cn("text-muted-foreground")} variant="label">{t('chat:cards.requestedBy', { name: sourceTitle })}</Text> : null}
        {request.title ? <Text className={cn("text-muted-foreground")} variant="label">{request.title}</Text> : null}
        {request.questions.map((prompt, questionIndex) => {
          if (questionIndex !== currentIndex) {
            return null;
          }

          const selected = answers[questionIndex];
          const showOptions = prompt.type !== 'boolean' && prompt.type !== 'external' && prompt.options.length > 0;
          const showCustom = prompt.custom !== false && prompt.type !== 'boolean' && prompt.type !== 'external';

          return (
            <View key={`${request.id}-${questionIndex}`} className={cn(stylesClasses.questionBlock)}>
              <Text className={cn("text-foreground")} variant="title">{prompt.header}</Text>
              {prompt.question && prompt.question !== prompt.header ? (
                <Text className={cn("text-foreground")} variant="description">{prompt.question}</Text>
              ) : null}

              {prompt.type === 'boolean' ? (
                <View className={cn(stylesClasses.questionBooleanRow)}>
                  <Text className={cn("text-foreground")} variant="description">{selected.includes('true') ? t('chat:cards.yes') : t('chat:cards.no')}</Text>
                  <Switch accessibilityLabel={prompt.header} checked={selected.includes('true')} onCheckedChange={(value) => {
                      setAnswers((current) => current.map((answer, index) => index === questionIndex ? [value ? 'true' : 'false'] : answer));
                    }}></Switch>
                </View>
              ) : null}

              {prompt.type === 'external' && prompt.url ? (
                <Button onPress={() => { void Linking.openURL(prompt.url as string).catch(() => undefined); }} variant="outline"><Icon name={"open-in-new"} size={20} /><Text>{t('chat:cards.openLink')}</Text></Button>
              ) : null}

              {showOptions ? (
                <View className={cn(stylesClasses.questionOptions)}>
                  {prompt.options.map((option) => {
                    const isSelected = selected.includes(option.label);
                    return (
                      <View key={option.label} className={cn("w-full gap-1")}>
                      <Button accessibilityLabel={[option.label, option.description].filter(Boolean).join('. ')} accessibilityState={{ selected: isSelected }} onPress={() => {
                          setAnswers((current) => current.map((answer, index) => {
                            if (index !== questionIndex) return answer;
                            if (!prompt.multiple) return [option.label];
                            return isSelected ? answer.filter((label) => label !== option.label) : [...answer, option.label];
                          }));
                          if (!prompt.multiple) {
                            setCustomAnswers((current) => current.map((answer, index) => index === questionIndex ? '' : answer));
                          }
                        }} variant={isSelected ? 'secondary' : 'outline'} className={cn("w-full", "justify-start")} ><Text className={cn("shrink")} >{option.label}</Text></Button>
                      {option.description ? <Text className={cn("text-muted-foreground px-3")} variant="label">{option.description}</Text> : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {showCustom ? (
                <TextField label={prompt.placeholder || t('chat:cards.customAnswer')} keyboardType={prompt.type === 'number' || prompt.type === 'integer' ? 'numeric' : 'default'} value={customAnswers[questionIndex]} onChangeText={(value) => {
                    setCustomAnswers((current) => current.map((answer, index) => index === questionIndex ? value : answer));
                    if (!prompt.multiple && value) {
                      setAnswers((current) => current.map((answer, index) => index === questionIndex ? [] : answer));
                    }
                  }}></TextField>
              ) : null}
            </View>
          );
        })}
        {error ? <Text className={cn("text-destructive")}>{error}</Text> : null}
        </ScrollView>
        <View className={cn(stylesClasses.questionFooter)} style={[{ backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button disabled={currentStep === 0 || Boolean(submitting)} onPress={() => setStep((value) => Math.max(0, value - 1))} variant="outline"><Text>{t('common:actions.back')}</Text></Button>
          {currentStep < visibleIndexes.length - 1 ? <Button disabled={!canAdvance || Boolean(submitting)} onPress={() => setStep((value) => value + 1)} variant="default"><Text>{t('common:actions.next')}</Text></Button> : <Button disabled={!canSubmit || Boolean(submitting)} onPress={handleReply} variant="default">{submitting === 'reply' ? <Spinner size="small" /> : null}<Text>{t('chat:cards.submitAnswer')}</Text></Button>}
          <Button disabled={Boolean(submitting)} onPress={handleReject} variant="ghost">{submitting === 'reject' ? <Spinner size="small" /> : null}<Text className={cn("text-destructive")} >{t('chat:cards.reject')}</Text></Button>
        </View>
      </KeyboardAvoidingView>
    </ModalSurface>
  );
}

const stylesClasses = {
  "questionBlock": "gap-2",
  "questionBooleanRow": "flex-row items-center justify-between gap-3",
  "questionOptions": "flex-row flex-wrap gap-2",
  "questionFooter": "border-t flex-row flex-wrap gap-2 justify-end px-4 pt-3"
} as const;
