import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initializeNotifications } from '@/lib/notifications';
import { getPaperTheme } from '@/constants/paper-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { OpencodeProvider } from '@/providers/opencode-provider';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const paperTheme = getPaperTheme(colorScheme === 'dark' ? 'dark' : 'light');

  useEffect(() => {
    void initializeNotifications();
  }, []);

  return (
    <SafeAreaProvider>
      <OpencodeProvider>
        <PaperProvider theme={paperTheme}>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="session/[id]"
                options={{
                  title: 'Session',
                  headerBackTitle: 'Back',
                }}
              />
            </Stack>
            <StatusBar style="auto" />
          </ThemeProvider>
        </PaperProvider>
      </OpencodeProvider>
    </SafeAreaProvider>
  );
}
