import { Tabs, usePathname } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Text, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/providers/theme-provider';

export default function TabLayout() {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const selected = (route: string) => route === '/' ? pathname === '/' || pathname.startsWith('/session/') : pathname.startsWith(route);
  const iconColor = (route: string, color: ColorValue) => Platform.OS === 'web' ? selected(route) ? palette.tint : palette.tabIconDefault : color;
  const label = (route: string, value: string) => function TabLabel({ color }: { color: ColorValue }) {
    return <Text maxFontSizeMultiplier={1.3} style={{ color: Platform.OS === 'web' ? selected(route) ? palette.tint : palette.tabIconDefault : color, fontSize: 12, fontWeight: '600' }}>{value}</Text>;
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.tint,
        tabBarInactiveTintColor: palette.tabIconDefault,
        tabBarHideOnKeyboard: false,
        tabBarStyle: {
          backgroundColor: palette.tabBackground,
          borderTopColor: palette.border,
          height: 56 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        headerShown: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'OpenCode Mobile',
          tabBarLabel: label('/', t('common:tabs.chat')),
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="message.fill" color={iconColor('/', color)} />,
          tabBarButton: (props) => <HapticTab {...props} route="/" />,
        }}
      />
      <Tabs.Screen
        name="terminal"
        options={{
          title: t('common:tabs.terminal'),
          tabBarLabel: label('/terminal', t('common:tabs.terminal')),
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="terminal.fill" color={iconColor('/terminal', color)} />,
          tabBarButton: (props) => <HapticTab {...props} route="/terminal" />,
        }}
      />
      <Tabs.Screen
        name="workspace"
        options={{
          title: t('common:tabs.workspace'),
          tabBarLabel: label('/workspace', t('common:tabs.workspace')),
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="folder.fill" color={iconColor('/workspace', color)} />,
          tabBarButton: (props) => <HapticTab {...props} route="/workspace" />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('common:tabs.settings'),
          tabBarLabel: label('/settings', t('common:tabs.settings')),
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={iconColor('/settings', color)} />,
          tabBarButton: (props) => <HapticTab {...props} route="/settings" />,
        }}
      />
    </Tabs>
  );
}
