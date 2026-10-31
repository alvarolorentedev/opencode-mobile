import { cn } from '@/shared/ui/cn';
import { Spinner } from '@/shared/ui/spinner';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ChatView } from '@/features/chat/ui/chat-view';
import { ProjectPicker } from '@/features/projects/index';
import { useChat } from '@/features/chat/context';
import { useConnection } from '@/features/connections/context';
import { useCurrentSession } from '@/features/sessions/context';
import { useBootState as useOnboarding } from '@/runtime/workspace';
import { useProjects } from '@/features/projects/context';
import { usePalette } from '@/shared/ui/theme/use-palette';

export default function ChatLandingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const palette = usePalette();
  const { activeProject } = useProjects();
  const { connection, connect } = useConnection();
  const { currentSessionId, ensureActiveSession } = useCurrentSession();
  const { isBootstrappingChat } = useChat();
  const { isHydrated } = useOnboarding();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!isHydrated || !activeProject || connection.status !== 'connected' || isBootstrappingChat || currentSessionId) {
      return;
    }

    void ensureActiveSession();
  }, [activeProject, connection.status, currentSessionId, ensureActiveSession, isBootstrappingChat, isHydrated]);

  async function reconnect() {
    setIsReconnecting(true);
    try {
      await connect();
    } finally {
      setIsReconnecting(false);
    }
  }

  if (!isHydrated) {
    return (
      <View className={cn(stylesClasses.center, "bg-background")}>
        <View className={cn(stylesClasses.panel, "bg-surface")}><Spinner size="large" color={palette.tint} /><Text className={cn(stylesClasses.title, "text-foreground")} variant="display">{t('chat:session.opening')}</Text><Text className={cn(stylesClasses.copy, "text-muted-foreground")} variant="description">{t('chat:session.loading')}</Text></View>
      </View>
    );
  }

  if (currentSessionId || (activeProject && connection.status === 'connected')) {
    return <ChatView />;
  }

  if (connection.status === 'connecting') {
    return (
      <View className={cn(stylesClasses.center, "bg-background")}>
        <View className={cn(stylesClasses.panel, "bg-surface")}><Spinner size="large" color={palette.tint} /><Text className={cn(stylesClasses.title, "text-foreground")} variant="display">{t('chat:session.opening')}</Text><Text className={cn(stylesClasses.copy, "text-muted-foreground")} variant="description">{t('chat:connectionStatus.connecting')}</Text></View>
      </View>
    );
  }

  if (connection.status !== 'connected') {
    return (
      <View className={cn(stylesClasses.center, "bg-background")}>
        <View className={cn(stylesClasses.panel, "bg-surface")}><Text className={cn(stylesClasses.title, "text-foreground")} variant="display">{t('chat:session.connectTitle')}</Text><Text className={cn(stylesClasses.copy, "text-muted-foreground")} variant="description">{connection.message}</Text><Button disabled={isReconnecting} onPress={() => {
              if (connection.status === 'error') void reconnect();
              else router.push('/(tabs)/settings');
            }} variant="default">{isReconnecting ? <Spinner size="small" /> : null}<Text>{connection.status === 'error' ? t('common:actions.reconnect') : t('common:actions.openSettings')}</Text></Button>{connection.status === 'error' ? (
            <Button onPress={() => router.push('/(tabs)/settings')} variant="ghost"><Text>{t('chat:session.connectionSettings')}</Text></Button>
          ) : null}</View>
      </View>
    );
  }

  return (
    <>
      <View className={cn(stylesClasses.center, "bg-background")}>
        <View className={cn(stylesClasses.panel, "bg-surface")}><Text className={cn(stylesClasses.title, "text-foreground")} variant="display">{t('chat:session.chooseProject')}</Text><Text className={cn(stylesClasses.copy, "text-muted-foreground")} variant="description">{t('chat:session.selectProject')}</Text><Button onPress={() => setPickerVisible(true)} variant="default"><Icon name={"folder-open-outline"} size={20} /><Text>{t('chat:session.openProject')}</Text></Button></View>
      </View>
      <ProjectPicker visible={pickerVisible} onClose={() => setPickerVisible(false)} testID="chat-landing-project-picker" />
    </>
  );
}

const stylesClasses = {
  "center": "flex-1 items-center justify-center p-6",
  "panel": "w-full p-6 gap-3 rounded-[16px]",
  "title": "text-center font-semibold",
  "copy": "text-center leading-[22px]"
} as const;
