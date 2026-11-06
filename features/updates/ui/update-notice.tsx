import { usePalette } from '@/shared/ui/theme/use-palette';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Feedback } from '@/shared/ui/feedback';
import { Portal } from '@/shared/ui/portal';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDismissOnBack } from '@/shared/ui/hooks/use-dismiss-on-back';
import type { UpdateSnapshot } from '@/shared/platform/app-updates';

// The finished-download prompt floats above the tab bar instead of taking
// layout space: it only offers Later or install. The offset is the 56px tab bar
// plus a 12px gap, so it sits above the default tab bar of the tab shell.
export function UpdateRestartToast({ notice, onUpdate, onLater }: {
  notice?: UpdateSnapshot; onUpdate: () => void; onLater: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const downloaded = notice?.phase === 'downloaded';
  if (!downloaded) return null;
  return <Feedback
    open
    duration={Infinity}
    onOpenChange={() => undefined}
    style={{ bottom: insets.bottom + 68 }}
    secondaryAction={{ label: t('common:updates.later'), onPress: onLater }}
    action={{ label: t('common:updates.restart'), onPress: onUpdate }}
  >{t('common:updates.downloadedDescription')}</Feedback>;
}

export function UpdateBanner({ notice, onUpdate, onLater }: {
  notice?: UpdateSnapshot; onUpdate: () => void; onLater: () => void;
}) {
  const { t } = useTranslation();
  const colors = usePalette();
  // A finished download is the restart toast; this banner stays for the store offer.
  if (!notice || notice.phase === 'downloaded') return null;
  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <View testID="app-update-notice" style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.copy} accessibilityLiveRegion="polite">
        <Text  variant="description">{t('common:updates.available')}</Text>
        <Text style={{ color: colors.muted }} variant="description">{t('common:updates.availableDescription')}</Text>
      </View>
      <View style={styles.actions}>
        <Button onPress={onLater} variant="ghost" style={[undefined, styles.action, undefined]}><Text>{t('common:updates.later')}</Text></Button>
        <Button onPress={onUpdate} variant="default" style={[undefined, styles.action, undefined]}><Text>{t('common:updates.openStore')}</Text></Button>
      </View>
    </View>
  </View>;
}

export function UpdateNotice({ busy, error, onDismissError, notice, onUpdate, onLater }: {
  busy: boolean; error: boolean; onDismissError: () => void;
  notice?: UpdateSnapshot; onUpdate: () => void; onLater: () => void;
}) {
  const { t } = useTranslation();
  useDismissOnBack(busy, () => {});
  return <Portal>{busy ? <View testID="app-update-handoff" accessible accessibilityViewIsModal accessibilityLiveRegion="polite" accessibilityLabel={t('common:updates.opening')} onStartShouldSetResponder={() => true} style={StyleSheet.absoluteFill} pointerEvents="auto" /> : null}<UpdateRestartToast notice={error ? undefined : notice} onUpdate={onUpdate} onLater={onLater} /><Feedback duration={4000} open={error} onOpenChange={() => (onDismissError)()}>{t('common:updates.failed')}</Feedback></Portal>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  banner: { width: '100%', maxWidth: 560, borderRadius: 12, borderWidth: 1, padding: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  copy: { flexGrow: 1, flexBasis: 144, gap: 4 },
  actions: { flexGrow: 1, flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  action: { minHeight: 44 }
});
