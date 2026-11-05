import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { useExtensions } from '@/features/extensions/context';
import { useConnection } from '@/features/connections/context';
import { useAppearance } from '@/shared/ui/theme/appearance-context';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { FieldDescription } from '@/shared/ui/text-field';
import { getErrorMessage } from '@/shared/utilities/error-message';
import type { PluginGuiBundle, PluginGuiPanel, PluginGuiTheme } from '@/features/extensions/model/plugin-gui';
import PluginGuiDom from '@/features/extensions/ui/plugin-gui-dom';

type SessionView = {
  id: string;
  directory?: string;
  title?: string;
};

type Props = {
  pluginId: string;
  session: SessionView;
  onClose: () => void;
  onOpenSession: (sessionID: string) => Promise<void>;
};

function normalize(value: string) {
  return value.toLowerCase().replace(/^@[^/]+\//, '').replace(/[^a-z0-9]/g, '');
}

/** The bundle loader, panel switcher and WebView shared by the chat overlay and the deep-link route. */
export function PluginGuiView({ pluginId, session, onClose, onOpenSession }: Props) {
  const { t, i18n } = useTranslation();
  const { extensions } = useExtensions();
  const { settings } = useConnection();
  const { scheme } = useAppearance();
  const palette = usePalette();
  const [bundle, setBundle] = useState<PluginGuiBundle>();
  const [panels, setPanels] = useState<PluginGuiPanel[]>([]);
  const [selectedPanel, setSelectedPanel] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const plugin = extensions.pluginGui.plugins.find((entry) => entry.id === pluginId);
  const read = extensions.pluginGui.read;
  const readRef = useRef(read);

  useEffect(() => {
    readRef.current = read;
  }, [read]);

  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      setBundle(undefined);
      setPanels([]);
      setSelectedPanel(undefined);
      setLoading(true);
      setError(undefined);
    });
    void readRef.current(pluginId).then(
      (value) => {
        if (!live) return;
        setBundle(value);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!live) return;
        setError(getErrorMessage(cause));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [pluginId]);

  const theme = useMemo<PluginGuiTheme>(() => ({
    mode: scheme,
    background: palette.background,
    foreground: palette.text,
    border: palette.border,
    tint: palette.tint,
    surface: palette.surface,
  }), [palette.background, palette.border, palette.surface, palette.text, palette.tint, scheme]);

  const openExternal = useCallback((url: string) => {
    if (!/^(https?|mailto):/i.test(url)) return;
    void Linking.openURL(url).catch(() => undefined);
  }, []);

  const rpc = useCallback(async (request: { rpcID: string; method: string; input?: unknown; directory?: string }) => {
    const pluginKey = normalize(pluginId);
    const rpcKey = normalize(request.rpcID);
    if (!pluginKey || (!pluginKey.includes(rpcKey) && !rpcKey.includes(pluginKey))) {
      throw new Error(`This plugin cannot call the "${request.rpcID}" RPC.`);
    }
    return extensions.pluginGui.rpc({ ...request, directory: session.directory });
  }, [extensions.pluginGui, pluginId, session.directory]);

  const sessionGet = useCallback(async (request: { sessionID: string }) => {
    if (request.sessionID !== session.id) throw new Error('This plugin can only read the current session.');
    return extensions.pluginGui.sessionGet(request);
  }, [extensions.pluginGui, session.id]);

  const selected = panels.find((panel) => panel.id === selectedPanel) ?? panels[0];

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center gap-3 p-6">
        <Spinner />
        <FieldDescription>{t('settings:extensions.gui.loading')}</FieldDescription>
      </View>
    );
  }
  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-3 p-6">
        <Text variant="label" className="text-center">{t('settings:extensions.gui.failed', { message: error })}</Text>
        <Button variant="outline" onPress={onClose}><Text>{t('common:actions.close')}</Text></Button>
      </View>
    );
  }
  if (!bundle) return null;

  return (
    <View className="flex-1">
      {panels.length > 1 ? (
        <View className="border-b border-border px-3 py-2">
          <Select
            value={selected ? { value: selected.id, label: selected.title } : undefined}
            onValueChange={(option) => {
              if (option) setSelectedPanel(option.value);
            }}
          >
            <SelectTrigger accessibilityLabel={t('settings:extensions.gui.title')} className="w-full">
              <SelectValue placeholder={t('settings:extensions.gui.title')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {panels.map((panel) => (
                  <SelectItem key={panel.id} value={panel.id} label={panel.title} />
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </View>
      ) : null}
      <PluginGuiDom
        code={bundle.code}
        pluginId={pluginId}
        label={plugin?.label ?? pluginId}
        options={bundle.options}
        session={{ id: session.id, directory: session.directory ?? settings.directory ?? '', title: session.title }}
        server={{ id: 'sidecar', name: 'OpenCode', url: settings.serverUrl, builtin: true }}
        theme={theme}
        locale={i18n.language}
        appVersion={Constants.expoConfig?.version ?? '0.0.0'}
        panelId={selectedPanel}
        onReady={async () => undefined}
        onPanels={async (value) => setPanels(value)}
        onError={async (message) => setError(message)}
        onEmpty={async () => setError(t('settings:extensions.gui.noPanel'))}
        onClose={async () => onClose()}
        onOpenSession={async (sessionID) => {
          try {
            await onOpenSession(sessionID);
          } catch (cause) {
            setError(getErrorMessage(cause));
          }
        }}
        onOpenExternal={async (url) => openExternal(url)}
        onRpc={rpc}
        onSessionGet={sessionGet}
        dom={{ style: { flex: 1 }, scrollEnabled: true, keyboardDisplayRequiresUserAction: true }}
      />
    </View>
  );
}
