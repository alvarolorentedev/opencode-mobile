import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type RevertNoticeProps = {
  busy?: boolean;
  onCancel: () => void;
};

export function RevertNotice({ busy = false, onCancel }: RevertNoticeProps) {
  const { t } = useTranslation();
  const palette = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={styles.stack}>
      <View testID="chat-revert-notice" style={[styles.notice, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
        <View style={styles.copy}>
          <Text variant="labelSmall" style={{ color: palette.muted }}>{t('chat:revertNotice.title')}</Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:revertNotice.hint')}</Text>
        </View>
        <IconButton
          testID="chat-revert-cancel"
          accessibilityLabel={t('chat:revertNotice.cancel')}
          icon="close"
          size={18}
          iconColor={palette.muted}
          disabled={busy}
          onPress={onCancel}
          style={styles.close}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { paddingHorizontal: 8, paddingTop: 6 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingLeft: 10, paddingVertical: 6, paddingRight: 2 },
  copy: { flex: 1, gap: 2 },
  close: { margin: 0 },
});
