import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { usePalette } from '@/shared/ui/theme/use-palette';

type RevertNoticeProps = {
  busy?: boolean;
  onCancel: () => void;
};

export function RevertNotice({ busy = false, onCancel }: RevertNoticeProps) {
  const { t } = useTranslation();
  const palette = usePalette();
  return (
    <View className={cn(stylesClasses.stack)}>
      <View testID="chat-revert-notice" className={cn(stylesClasses.notice, "bg-surface-alt border-border")}>
        <View className={cn(stylesClasses.copy)}>
          <Text className={cn("text-muted-foreground")} variant="label">{t('chat:revertNotice.title')}</Text>
          <Text className={cn("text-muted-foreground")} variant="label">{t('chat:revertNotice.hint')}</Text>
        </View>
        <Button testID="chat-revert-cancel" accessibilityLabel={t('chat:revertNotice.cancel')} disabled={busy} onPress={onCancel} variant="ghost" size="icon" className={cn(stylesClasses.close)} ><Icon name={"close"} size={18} color={palette.muted} /></Button>
      </View>
    </View>
  );
}

const stylesClasses = {
  "stack": "px-2 pt-1.5",
  "notice": "flex-row items-center gap-2 border rounded-[10px] pl-2.5 py-1.5 pr-0.5",
  "copy": "flex-1 gap-0.5",
  "close": "m-0"
} as const;
