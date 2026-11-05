import { View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useConnection } from '@/features/connections/context';
import { useExtensions } from '@/features/extensions/context';
import { useSessionLibrary } from '@/features/sessions/context';
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
  const { height } = useWindowDimensions();
  const { extensions } = useExtensions();
  const { settings } = useConnection();
  const { openSessionInProject } = useSessionLibrary();
  const plugin = extensions.pluginGui.plugins.find((entry) => entry.id === pluginId);
  // No selected session (brand-new chat): fall back to the connection
  // directory so globally installed plugins still render and can offer
  // their own run/session picker.
  const effectiveSession = session ?? { id: '', directory: settings.directory || undefined, title: '' };

  return (
    <OverlaySheet
      visible={visible && Boolean(pluginId)}
      title={plugin?.label ?? pluginId ?? t('settings:extensions.gui.title')}
      onClose={onClose}
      scrollable={false}
      fitContent={false}
    >
      {pluginId ? (
        <View style={{ height: Math.max(320, height * 0.72), minHeight: 0 }}>
          <PluginGuiView
            pluginId={pluginId}
            session={effectiveSession}
            onClose={onClose}
            onOpenSession={async (sessionID) => {
              // In-app navigation from rendered plugin data: resolve the
              // workspace locally instead of going through the external
              // session deep link, which would lose the project context.
              await openSessionInProject(effectiveSession.directory ?? settings.directory ?? '', sessionID);
              onClose();
            }}
          />
        </View>
      ) : null}
    </OverlaySheet>
  );
}
