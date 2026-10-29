import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';
import { Appbar } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ControlSize, Spacing } from '@/constants/design-tokens';
import { SettingsPanel, useSettingsTarget } from './settings-panel';
import type { Palette } from './sections/setting-rows';

export function VoiceFlowScreen({ title, onBack, onClose, palette, children, footer, contentKey }: {
  title: string; onBack: () => void; onClose: () => void; palette: Palette; children: ReactNode; footer?: ReactNode; contentKey?: number;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const target = useSettingsTarget();
  return <Modal animationType="slide" presentationStyle="fullScreen" onRequestClose={onBack}>
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction accessibilityLabel={t('common:actions.back')} onPress={onBack} />
        <Appbar.Content title={title} titleStyle={{ color: palette.text, fontSize: 18, fontWeight: '600' }} />
        <Appbar.Action icon="close" accessibilityLabel={t('common:actions.close')} onPress={onClose} />
      </Appbar.Header>
      <View style={styles.panel}><SettingsPanel key={contentKey ?? title} target={target}><View style={styles.body}>{children}</View></SettingsPanel></View>
      {footer ? <View style={[styles.footer, { borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}><View style={styles.body}>{footer}</View></View> : null}
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  panel: { flex: 1, padding: Spacing.lg },
  body: { width: '100%', maxWidth: ControlSize.contentWidth, alignSelf: 'center', gap: Spacing.lg },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.lg },
});
