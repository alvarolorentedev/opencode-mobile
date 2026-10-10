import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Portal, Snackbar, Text } from 'react-native-paper';

import type { UpdateSnapshot } from '@/lib/app-updates';
import { OverlaySheet } from '@/components/ui/overlay-sheet';

export function UpdateNotice({ notice, busy, installing, error, onUpdate, onLater, onDismissError }: {
  notice?: UpdateSnapshot; busy: boolean; installing: boolean; error: boolean;
  onUpdate: () => void; onLater: () => void; onDismissError: () => void;
}) {
  const { t } = useTranslation();
  return <>
    <OverlaySheet
      visible={Boolean(notice)}
      fitContent
      blockUpdates={false}
      testID="app-update-notice"
      title={t(notice?.phase === 'downloaded' ? 'common:updates.ready' : 'common:updates.available')}
      onClose={onLater}>
      <View style={styles.actions}>
        <Button mode="text" contentStyle={styles.action} onPress={onLater}>{t('common:updates.later')}</Button>
        <Button mode="contained" contentStyle={styles.action} onPress={onUpdate}>{t('common:updates.update')}</Button>
      </View>
    </OverlaySheet>
    <OverlaySheet
      visible={busy || installing}
      fitContent
      dismissible={false}
      blockUpdates={false}
      title={t('common:updates.update')}
      onClose={() => {}}>
      <View style={styles.progress}>
        <ActivityIndicator />
        <Text accessibilityLiveRegion="polite">{t(installing ? 'common:updates.installing' : 'common:updates.opening')}</Text>
      </View>
    </OverlaySheet>
    <Portal>
      <Snackbar visible={error} onDismiss={onDismissError} duration={4000}>{t('common:updates.failed')}</Snackbar>
    </Portal>
  </>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  action: { minHeight: 44 },
  progress: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 24 },
});
