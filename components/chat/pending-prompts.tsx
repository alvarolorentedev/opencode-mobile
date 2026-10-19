import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Text } from 'react-native-paper';

import { AttachmentStrip } from '@/components/chat/attachment-strip';
import type { PendingPrompt } from '@/lib/opencode/prompt-inbox';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type PendingPromptsProps = {
  cancelingId?: string;
  onCancel: (prompt: PendingPrompt) => void;
  prompts: PendingPrompt[];
};

export function PendingPrompts({ cancelingId, onCancel, prompts }: PendingPromptsProps) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  if (!prompts.length) return null;
  return (
    <ScrollView testID="pending-prompts" style={styles.stack} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {prompts.map((prompt) => {
        const sending = prompt.state === 'sending';
        const canceling = cancelingId === prompt.id;
        return (
          <View key={prompt.id} testID="pending-prompt" style={[styles.prompt, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
            <View style={styles.promptBody}>
              <Text variant="labelSmall" style={{ color: palette.muted }}>
                {t(sending ? 'chat:pendingPrompts.sending' : 'chat:pendingPrompts.waiting')}{' · '}
                {t(prompt.delivery === 'queue' ? 'settings:providers.promptDelivery.queue.label' : 'settings:providers.promptDelivery.steer.label')}
              </Text>
              {prompt.attachments.length ? <AttachmentStrip attachments={prompt.attachments} /> : null}
              {prompt.text ? <Text style={{ color: palette.text }}>{prompt.text}</Text> : null}
            </View>
            {canceling ? (
              <ActivityIndicator size={16} color={palette.muted} style={styles.close} />
            ) : (
              <IconButton
                testID={`pending-prompt-cancel-${prompt.id}`}
                accessibilityLabel={t('chat:pendingPrompts.cancel')}
                icon="close"
                size={18}
                iconColor={palette.muted}
                disabled={sending}
                onPress={() => onCancel(prompt)}
                style={styles.close}
              />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stack: { maxHeight: '25%', flexGrow: 0, flexShrink: 1 },
  content: { gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  prompt: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 10, padding: 8, gap: 6 },
  promptBody: { flex: 1, gap: 6 },
  close: { margin: 0 },
});
