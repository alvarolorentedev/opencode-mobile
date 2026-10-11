import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Portal, Snackbar, Text, useTheme } from 'react-native-paper';

import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';
import type { UpdateSnapshot } from '@/lib/app-updates';

export function UpdateBanner({ notice, onUpdate, onLater }: {
  notice?: UpdateSnapshot; onUpdate: () => void; onLater: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const downloaded = notice?.phase === 'downloaded';
  if (!notice) return null;
  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <View testID="app-update-notice" style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
      <View style={styles.copy} accessibilityLiveRegion="polite">
        <Text variant="titleSmall">{t(downloaded ? 'common:updates.ready' : 'common:updates.available')}</Text>
        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>{t(downloaded ? 'common:updates.readyDescription' : 'common:updates.availableDescription')}</Text>
      </View>
      <View style={styles.actions}>
        <Button mode="text" contentStyle={styles.action} onPress={onLater}>{t('common:updates.later')}</Button>
        <Button mode="contained" contentStyle={styles.action} onPress={onUpdate}>{t(downloaded ? 'common:updates.restart' : 'common:updates.openStore')}</Button>
      </View>
    </View>
  </View>;
}

export function UpdateNotice({ busy, installing, error, onDismissError }: {
  busy: boolean; installing: boolean; error: boolean; onDismissError: () => void;
}) {
  const { t } = useTranslation();
  useDismissOnBack(busy || installing, () => {});
  return <Portal>
    {busy || installing ? <View testID="app-update-handoff" accessible accessibilityViewIsModal accessibilityLiveRegion="polite" accessibilityLabel={t(installing ? 'common:updates.installing' : 'common:updates.opening')} onStartShouldSetResponder={() => true} style={StyleSheet.absoluteFill} pointerEvents="auto" /> : null}
    <Snackbar visible={error} onDismiss={onDismissError} duration={4000}>{t('common:updates.failed')}</Snackbar>
  </Portal>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  banner: { width: '100%', maxWidth: 560, borderRadius: 12, borderWidth: 1, padding: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  copy: { flexGrow: 1, flexBasis: 144, gap: 4 },
  actions: { flexGrow: 1, flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  action: { minHeight: 44 },
});
