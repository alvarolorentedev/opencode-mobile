import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '@/features/extensions/context';
import { useCurrentSession, useSessionLibrary } from '@/features/sessions/context';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';
import { PluginGuiView } from '@/features/extensions/ui/plugin-gui-view';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function PluginGuiScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[]; session?: string | string[] }>();
  const pluginId = first(params.id);
  const requestedSession = first(params.session);
  const insets = useSafeAreaInsets();
  const { extensions } = useExtensions();
  const { currentSessionId, activeSession } = useCurrentSession();
  const { sessions, openSessionInProject } = useSessionLibrary();
  const sessionId = requestedSession ?? currentSessionId;
  const session = sessions.find((entry) => entry.id === sessionId) ?? (activeSession?.id === sessionId ? activeSession : undefined) ?? sessions[0];
  const plugin = extensions.pluginGui.plugins.find((entry) => entry.id === pluginId);
  const close = () => router.back();

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2 border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon" accessibilityLabel={t('common:actions.back')} onPress={close}>
          <Icon name="chevron-left" />
        </Button>
        <View className="min-w-0 flex-1">
          <Text variant="label" numberOfLines={1}>{plugin?.label ?? pluginId ?? t('settings:extensions.gui.title')}</Text>
          <Text variant="description" numberOfLines={1}>{t('settings:extensions.gui.title')}</Text>
        </View>
      </View>
      {!pluginId ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text variant="label" className="text-center">{t('settings:extensions.gui.unavailable')}</Text>
          <Button variant="outline" onPress={close}><Text>{t('common:actions.close')}</Text></Button>
        </View>
      ) : !session ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text variant="label" className="text-center">{t('settings:extensions.gui.sessionRequired')}</Text>
          <Button variant="outline" onPress={close}><Text>{t('common:actions.close')}</Text></Button>
        </View>
      ) : (
        <PluginGuiView
          pluginId={pluginId}
          session={session}
          onClose={close}
          onOpenSession={async (sessionID) => {
            // Same in-app navigation as the overlay: keep the project
            // context instead of falling back to the external deep link.
            await openSessionInProject(session.directory ?? '', sessionID);
            router.replace('/(tabs)' as never);
          }}
        />
      )}
    </View>
  );
}
