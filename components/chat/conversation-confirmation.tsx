import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { TextInput } from '@/components/ui/text-input';
import type { Palette } from '@/constants/theme';
import type { ConversationConfirmationState } from '@/providers/opencode-provider-types';

export function ConversationConfirmation({
  confirmation,
  palette,
}: {
  confirmation: ConversationConfirmationState;
  palette: Palette;
}) {
  const { t } = useTranslation();
  // The card unmounts when confirmation ends, so the initial value is enough.
  // Provider-driven text changes only happen when a new command is captured.
  const [draft, setDraft] = useState(confirmation.text);
  const editing = confirmation.phase === 'editing';

  const status = confirmation.phase === 'prompting'
    ? t('chat:confirmation.prompting')
    : confirmation.phase === 'listening'
      ? t('chat:confirmation.listening')
      : confirmation.phase === 'editing'
        ? t('chat:confirmation.editHint')
        : t('chat:confirmation.expired');

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
      testID="conversation-confirmation"
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:confirmation.title')}</Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{status}</Text>
        </View>
        {confirmation.speaking ? <ActivityIndicator size="small" color={palette.tint} /> : null}
      </View>

      {editing ? (
        <TextInput
          autoFocus
          accessibilityLabel={t('chat:confirmation.editLabel')}
          mode="outlined"
          multiline
          testID="conversation-confirm-edit"
          value={draft}
          onChangeText={setDraft}
        />
      ) : (
        <Text selectable variant="titleMedium" style={[styles.command, { color: palette.text }]}>
          {confirmation.text}
        </Text>
      )}

      {confirmation.heard && confirmation.heard !== confirmation.text ? (
        <Text variant="bodySmall" style={{ color: palette.muted }}>
          {t('chat:confirmation.heard', { text: confirmation.heard })}
        </Text>
      ) : null}
      {confirmation.error ? (
        <Text accessibilityLiveRegion="assertive" variant="bodySmall" style={{ color: palette.warning }}>
          {confirmation.error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          mode="contained"
          testID="conversation-confirm-send"
          onPress={() => confirmation.actions.confirm(editing ? draft : undefined)}
        >
          {t('chat:confirmation.send')}
        </Button>
        <Button mode="outlined" testID="conversation-confirm-retry" onPress={confirmation.actions.retry}>
          {t('common:actions.retry')}
        </Button>
        <Button mode="outlined" testID="conversation-confirm-edit-action" onPress={confirmation.actions.edit}>
          {t('common:actions.edit')}
        </Button>
        <Button mode="text" testID="conversation-confirm-cancel" onPress={confirmation.actions.cancel}>
          {t('common:actions.cancel')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { borderRadius: 18, borderWidth: 1, gap: 12, padding: 16 },
  command: { lineHeight: 26 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  headerText: { flex: 1, gap: 4 },
});
