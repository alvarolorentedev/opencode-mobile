import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Banner, Portal, Snackbar, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { UpdateSnapshot } from '@/lib/app-updates';

export function UpdateNotice({ notice, busy, installing, error, onUpdate, onLater, onDismissError }: {
  notice?: UpdateSnapshot; busy: boolean; installing: boolean; error: boolean;
  onUpdate: () => void; onLater: () => void; onDismissError: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return <>
    <Portal>
      {notice ? <View pointerEvents="box-none" style={[styles.banner, { top: insets.top + 64 }]}>
        <Banner testID="app-update-notice" visible icon="download" actions={[
          { label: t('common:updates.later'), onPress: onLater, contentStyle: styles.action },
          { label: t('common:updates.update'), onPress: onUpdate, contentStyle: styles.action },
        ]} style={{ backgroundColor: colors.surface }}>
          {t(notice.phase === 'downloaded' ? 'common:updates.ready' : 'common:updates.available')}
        </Banner>
      </View> : null}
      <Snackbar visible={error} onDismiss={onDismissError} duration={4000}>{t('common:updates.failed')}</Snackbar>
    </Portal>
    <Modal visible={busy || installing} transparent animationType="fade" onRequestClose={() => {}}>
      <View accessibilityViewIsModal style={styles.gate}>
        <View style={[styles.progress, { backgroundColor: colors.surface }]}>
          <ActivityIndicator />
          <Text accessibilityLiveRegion="polite">{t(installing ? 'common:updates.installing' : 'common:updates.opening')}</Text>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  banner: { position: 'absolute', left: 12, right: 12 },
  action: { minHeight: 44 },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  progress: { borderRadius: 16, padding: 24, gap: 16, maxWidth: '90%' },
});
