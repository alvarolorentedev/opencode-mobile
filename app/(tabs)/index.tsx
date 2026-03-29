import { useEffect } from 'react';
import { Center, Heading, Spinner, Text, VStack } from '@gluestack-ui/themed';

import { ChatView } from '@/components/chat/chat-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOpencode } from '@/providers/opencode-provider';

export default function ChatLandingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const {
    activeProject,
    connection,
    currentSessionId,
    ensureActiveSession,
    isBootstrappingChat,
    isHydrated,
  } = useOpencode();

  useEffect(() => {
    if (
      !isHydrated ||
      !activeProject ||
      connection.status !== 'connected' ||
      isBootstrappingChat ||
      currentSessionId
    ) {
      return;
    }

    void ensureActiveSession();
  }, [activeProject, connection.status, currentSessionId, ensureActiveSession, isBootstrappingChat, isHydrated]);

  if (currentSessionId) {
    return <ChatView />;
  }

  if (!activeProject) {
    return (
      <Center flex={1} px={24} bg={palette.background}>
        <VStack
          w="$full"
          space="md"
          borderWidth={1}
          borderColor={palette.border}
          borderRadius={28}
          p={24}
          alignItems="center"
          bg={palette.card}>
          <Heading style={[styles.title, { color: palette.text }]}>Choose a project</Heading>
          <Text style={[styles.copy, { color: palette.muted }]}>Select a server project or folder in the `Workspaces` tab to load chats for that context.</Text>
        </VStack>
      </Center>
    );
  }

  return (
    <Center flex={1} px={24} bg={palette.background}>
      <VStack
        w="$full"
        space="md"
        borderWidth={1}
        borderColor={palette.border}
        borderRadius={28}
        p={24}
        alignItems="center"
        bg={palette.card}>
        <Spinner size="large" color={palette.tint} />
        <Heading style={[styles.title, { color: palette.text }]}>Opening your latest chat</Heading>
        <Text style={[styles.copy, { color: palette.muted }]}> 
          {connection.status === 'error'
            ? connection.message
            : 'Fetching history from OpenCode and preparing the conversation view.'}
        </Text>
      </VStack>
    </Center>
  );
}

const styles = {
  title: {
    fontSize: 28,
    fontFamily: Fonts.display,
  },
  copy: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
} as const;
