import { cn } from '@/lib/utils';
import { ModalSurface } from '@/components/ui/portal';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { HeaderTitle, ScreenHeader } from '@/components/ui/screen-header';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ControlSize, Spacing } from '@/constants/design-tokens';
import { SettingsPanel, useSettingsTarget } from './settings-panel';
import { Palette } from './sections/setting-rows';

export function VoiceFlowScreen({ title, onBack, onClose, palette, children, footer, contentKey }: {
  title: string; onBack: () => void; onClose: () => void; palette: Palette; children: ReactNode; footer?: ReactNode; contentKey?: number;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const target = useSettingsTarget();
  return <ModalSurface accessibilityLabel={title} animationType="slide" presentationStyle="fullScreen" onRequestClose={onBack}>
    <View className={cn(stylesClasses.screen, "bg-background")}>
      <ScreenHeader className={cn("bg-background")}><Button accessibilityLabel={t('common:actions.back')} onPress={onBack} variant="ghost" size="icon"><Icon name={"arrow-left"} size={24} /></Button><HeaderTitle title={title} textStyle={{ color: palette.text, fontSize: 18, fontWeight: '600' }}></HeaderTitle><Button accessibilityLabel={t('common:actions.close')} onPress={onClose} variant="ghost" size="icon"><Icon name={"close"} size={24} /></Button></ScreenHeader>
      <View className={cn(stylesClasses.panel)}><SettingsPanel key={contentKey ?? title} target={target}><View style={styles.body}>{children}</View></SettingsPanel></View>
      {footer ? <View style={[styles.footer, { borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}><View style={styles.body}>{footer}</View></View> : null}
    </View>
  </ModalSurface>;
}
const styles = StyleSheet.create({
  body: { width: '100%', maxWidth: ControlSize.contentWidth, alignSelf: 'center', gap: Spacing.lg },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.lg }
});

const stylesClasses = {
  "screen": "flex-1",
  "panel": "flex-1 p-lg"
} as const;
