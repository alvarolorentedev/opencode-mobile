import { View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useConnection } from '@/features/connections/context';
import { useExtensions } from '@/features/extensions/context';
import { useSessionLibrary } from '@/features/sessions/context';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { activePluginGui } from '@/features/extensions/model/plugin-gui';
import { PluginGuiView } from '@/features/extensions/ui/plugin-gui-view';

type Props = {
  visible: boolean;
  session?: { id: string; directory?: string; title?: string };
  onClose: () => void;
};

export function PluginGuiOverlay({ visible, session, onClose }: Props) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const { extensions } = useExtensions();
  const { settings } = useConnection();
  const { openSessionInProject } = useSessionLibrary();
  const plugins = extensions.pluginGui.plugins;
  const plugin = activePluginGui(plugins, extensions.pluginGui.selectedPluginId);
  const pluginId = plugin?.id;
  // No selected session (brand-new chat): fall back to the connection
  // directory so globally installed plugins still render and can offer
  // their own run/session picker.
  const effectiveSession = session ?? { id: '', directory: settings.directory || undefined, title: '' };

  return (
    <OverlaySheet
      visible={visible && Boolean(pluginId)}
      title={t('settings:extensions.gui.title')}
      onClose={onClose}
      scrollable={false}
      fitContent={false}
    >
      {pluginId ? (
        <View style={{ height: Math.max(320, height * 0.72), minHeight: 0 }} className="gap-2">
          {plugins.length > 1 ? (
            <Select
              value={{ value: pluginId, label: plugin?.label ?? pluginId }}
              onValueChange={(option) => {
                if (option) extensions.pluginGui.selectPlugin(option.value);
              }}
            >
              <SelectTrigger accessibilityLabel={t('settings:extensions.gui.title')} className="w-full">
                <SelectValue placeholder={t('settings:extensions.gui.title')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {plugins.map((entry) => (
                    <SelectItem
                      key={entry.id}
                      value={entry.id}
                      label={entry.label}
                      description={[entry.version, entry.source.type].filter(Boolean).join(' · ')}
                    />
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
          <PluginGuiView
            key={pluginId}
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
