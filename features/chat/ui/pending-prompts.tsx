import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Spinner } from '@/shared/ui/spinner';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AttachmentStrip } from '@/features/sharing/index';
import type { PendingPrompt } from '@/shared/protocol/opencode/prompt-inbox';
import { usePalette } from '@/shared/ui/theme/use-palette';

type PendingPromptsProps = {
  cancelingId?: string;
  onCancel: (prompt: PendingPrompt) => void;
  prompts: PendingPrompt[];
};

export function PendingPrompts({ cancelingId, onCancel, prompts }: PendingPromptsProps) {
  const { t } = useTranslation();
  const palette = usePalette();
  if (!prompts.length) return null;
  return (
    <ScrollView testID="pending-prompts" className={cn(stylesClasses.stack)} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {prompts.map((prompt) => {
        const sending = prompt.state === 'sending';
        const canceling = cancelingId === prompt.id;
        const stateLabel = prompt.state === 'queued'
          ? t('chat:pendingPrompts.queued')
          : prompt.state === 'uncertain'
            ? t('chat:pendingPrompts.uncertain')
            : t(sending ? 'chat:pendingPrompts.sending' : 'chat:pendingPrompts.waiting');
        return (
          <View key={prompt.id} testID="pending-prompt" className={cn(stylesClasses.prompt, "bg-surface-alt border-border")}>
            <View className={cn(stylesClasses.promptBody)}>
              <Text className={cn("text-muted-foreground")} variant="label">{stateLabel}{' · '}{t(prompt.delivery === 'queue' ? 'settings:providers.promptDelivery.queue.label' : 'settings:providers.promptDelivery.steer.label')}</Text>
              {prompt.attachments.length ? <AttachmentStrip attachments={prompt.attachments} /> : null}
              {prompt.text ? <Text className={cn("text-foreground")}>{prompt.text}</Text> : null}
            </View>
            {canceling ? (
              <Spinner size={16} color={palette.muted} className={cn(stylesClasses.close)} />
            ) : (
              <Button testID={`pending-prompt-cancel-${prompt.id}`} accessibilityLabel={t('chat:pendingPrompts.cancel')} disabled={sending} onPress={() => onCancel(prompt)} variant="ghost" size="icon" className={cn(stylesClasses.close)} ><Icon name={"close"} size={18} color={palette.muted} /></Button>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 6, paddingHorizontal: 8, paddingVertical: 6 }
});

const stylesClasses = {
  "stack": "max-h-[25%] grow-0 shrink",
  "prompt": "flex-row items-start border rounded-[10px] p-2 gap-1.5",
  "promptBody": "flex-1 gap-1.5",
  "close": "m-0"
} as const;
