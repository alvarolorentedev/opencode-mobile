import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';

// Derived from expo-router's own tab screen options. expo-router 57 vendors
// react-navigation and is no longer compatible with the standalone
// @react-navigation packages, so the button is rendered with RN Pressable.
type TabBarButtonProps = Parameters<
  NonNullable<
    Exclude<
      NonNullable<ComponentProps<typeof Tabs.Screen>['options']>,
      (...args: never[]) => unknown
    >['tabBarButton']
  >
>[0];

export function HapticTab({ onPressIn, ...props }: TabBarButtonProps) {
  return (
    <Pressable
      {...(props as ComponentProps<typeof Pressable>)}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === 'ios') {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onPressIn?.(ev);
      }}
    />
  );
}
