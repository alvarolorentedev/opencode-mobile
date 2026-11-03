import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '@/features/extensions/context';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { PluginGuiView } from '@/features/extensions/ui/plugin-gui-view';

type Props = {
  visible: boolean;
  pluginId?: string;
  session?: { id: string; directory?: string; title?: string };
  onClose: () => void;
};

export function PluginGuiOverlay({ visible, pluginId, session, onClose }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { extensions } = useExtensions();
  const plugin = extensions.pluginGui.plugins.find((entry) => entry.id === pluginId);

  return (
    <OverlaySheet
      visible={visible && Boolean(pluginId) && Boolean(session)}
      title={plugin?.label ?? pluginId ?? t('settings:extensions.gui.title')}
      onClose={onClose}
      scrollable={false}
      fitContent={false}
    >
      {pluginId && session ? (
        <View style={{ height: Math.max(320, height * 0.72), minHeight: 0 }}>
          <PluginGuiView
            pluginId={pluginId}
            session={session}
            onClose={onClose}
            onOpenSession={(sessionID) => {
              onClose();
              router.push(`/session/${sessionID}` as never);
            }}
          />
        </View>
      ) : null}
    </OverlaySheet>
  );
}
