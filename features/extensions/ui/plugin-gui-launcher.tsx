import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '@/features/extensions/context';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { PluginGuiOverlay } from '@/features/extensions/ui/plugin-gui-overlay';
import type { Session } from '@/shared/protocol/opencode/types';

/** The chat header entry point for plugin GUIs. */
export function PluginGuiLauncher({ session }: { session?: Session }) {
  const { t } = useTranslation();
  const { extensions } = useExtensions();
  const [open, setOpen] = useState(false);
  const load = extensions.pluginGui.load;
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void loadRef.current().catch(() => undefined);
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
        onPress={() => setOpen(true)}
        variant="ghost"
        size="icon"
      >
        <Icon name="puzzle-outline" size={24} />
      </Button>
      <PluginGuiOverlay
        visible={open}
        session={session}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
