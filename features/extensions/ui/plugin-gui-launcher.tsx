import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '@/features/extensions/context';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { ListRow } from '@/shared/ui/list-row';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { PluginGuiOverlay } from '@/features/extensions/ui/plugin-gui-overlay';
import type { Session } from '@/shared/protocol/opencode/types';

/** The chat header entry point for plugin GUIs. */
export function PluginGuiLauncher({ session }: { session?: Session }) {
  const { t } = useTranslation();
  const { extensions } = useExtensions();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const load = extensions.pluginGui.load;
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let live = true;
    void loadRef.current().catch(() => undefined).finally(() => {
      if (live) setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const plugins = extensions.pluginGui.plugins;
  // The navbar control exists when the connection has at least one active
  // plugin advertising a renderable GUI (features.gui). It is not gated on
  // the selected session: same-server, globally installed plugins must show
  // on every chat, including a brand-new empty one. The API has no finer
  // "has a Panel" flag without evaluating the bundle.
  if (plugins.length === 0) return null;

  return (
    <>
      <Button
        testID="chat-plugin-guis"
        accessibilityLabel={t('settings:extensions.gui.title')}
        onPress={() => {
          if (plugins.length === 1) setSelected(plugins[0].id);
          else setOpen(true);
        }}
        variant="ghost"
        size="icon"
      >
        <Icon name="puzzle-outline" size={24} />
      </Button>
      <OverlaySheet
        visible={open}
        title={t('settings:extensions.gui.title')}
        onClose={() => setOpen(false)}
        fitContent
      >
        <View className="gap-3">
          <Text variant="description">{t('settings:extensions.gui.description')}</Text>
          {!loaded ? <Spinner /> : null}
          {loaded && !plugins.length ? <Text variant="description">{t('settings:extensions.gui.empty')}</Text> : null}
          {plugins.map((plugin) => (
            <View key={plugin.id} className="border-b border-border pb-2">
              <ListRow
                title={plugin.label}
                description={[plugin.version, plugin.source.type].filter(Boolean).join(' · ')}
              />
              <View className="flex-row justify-end">
                <Button
                  variant="ghost"
                  onPress={() => {
                    setOpen(false);
                    setSelected(plugin.id);
                  }}
                >
                  <Text>{t('common:actions.open')}</Text>
                </Button>
              </View>
            </View>
          ))}
        </View>
      </OverlaySheet>
      <PluginGuiOverlay
        visible={Boolean(selected)}
        pluginId={selected}
        session={session}
        onClose={() => setSelected(undefined)}
      />
    </>
  );
}
