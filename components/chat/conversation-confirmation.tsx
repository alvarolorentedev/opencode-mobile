import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';



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
      className={cn(stylesClasses.card, "bg-surface border-border")}
      testID="conversation-confirmation"
    >
      <View className={cn(stylesClasses.header)}>
        <View className={cn(stylesClasses.headerText)}>
          <Text className={cn("text-foreground")} variant="title">{t('chat:confirmation.title')}</Text>
          <Text className={cn("text-muted-foreground")} variant="label">{status}</Text>
        </View>
        {confirmation.speaking ? <ActivityIndicator size="small" color={palette.tint} /> : null}
      </View>

      {editing ? (
        <TextField autoFocus accessibilityLabel={t('chat:confirmation.editLabel')} multiline testID="conversation-confirm-edit" value={draft} onChangeText={setDraft}></TextField>
      ) : (
        <Text selectable className={cn(stylesClasses.command, "text-foreground")} variant="title">{confirmation.text}</Text>
      )}

      {confirmation.heard && confirmation.heard !== confirmation.text ? (
        <Text className={cn("text-muted-foreground")} variant="label">{t('chat:confirmation.heard', { text: confirmation.heard })}</Text>
      ) : null}
      {confirmation.error ? (
        <Text accessibilityLiveRegion="assertive" className={cn("text-warning")} variant="label">{confirmation.error}</Text>
      ) : null}

      <View className={cn(stylesClasses.actions)}>
        <Button testID="conversation-confirm-send" onPress={() => confirmation.actions.confirm(editing ? draft : undefined)} variant="default"><Text>{t('chat:confirmation.send')}</Text></Button>
        <Button testID="conversation-confirm-retry" onPress={confirmation.actions.retry} variant="outline"><Text>{t('common:actions.retry')}</Text></Button>
        <Button testID="conversation-confirm-edit-action" onPress={confirmation.actions.edit} variant="outline"><Text>{t('common:actions.edit')}</Text></Button>
        <Button testID="conversation-confirm-cancel" onPress={confirmation.actions.cancel} variant="ghost"><Text>{t('common:actions.cancel')}</Text></Button>
      </View>
    </View>
  );
}



const stylesClasses = {
  "card": "rounded-[18px] border gap-3 p-4",
  "header": "items-center flex-row gap-3 justify-between",
  "headerText": "flex-1 gap-1",
  "command": "leading-[26px]",
  "actions": "flex-row flex-wrap gap-2"
} as const;
