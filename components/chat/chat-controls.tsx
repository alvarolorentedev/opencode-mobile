import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Menu, Text, TouchableRipple } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function MenuControl({
  active,
  children,
  icon,
  iconName,
  label,
  maxWidth,
  onClose,
  onOpen,
}: {
  active: boolean;
  children: ReactNode;
  icon?: (props: { size: number; color: string }) => ReactNode;
  iconName?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  maxWidth?: number;
  onClose: () => void;
  onOpen: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const anchor = (
    <ControlButton
      active={active || visible}
      icon={icon}
      iconName={iconName}
      maxWidth={maxWidth}
      onPress={() => {
        setVisible(true);
        onOpen();
      }}>
      {label}
    </ControlButton>
  );

  if (!visible) {
    return anchor;
  }

  return (
    <Menu
      visible={visible}
      onDismiss={() => {
        setVisible(false);
        onClose();
      }}
      anchor={anchor}>
      {children}
    </Menu>
  );
}

export function ControlButton({
  active = false,
  children,
  icon,
  iconName,
  iconOnly = false,
  loading = false,
  maxWidth,
  onPress,
}: {
  active?: boolean;
  children: string;
  icon?: (props: { size: number; color: string }) => ReactNode;
  iconName?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  iconOnly?: boolean;
  loading?: boolean;
  maxWidth?: number;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const textColor = active ? palette.tint : palette.text;
  const borderColor = active ? 'transparent' : palette.border;
  const backgroundColor = active ? `${palette.tint}18` : palette.surface;

  return (
    <TouchableRipple
      onPress={onPress}
      borderless={false}
      style={[
        styles.controlButton,
        iconOnly ? styles.controlButtonIconOnly : styles.controlButtonText,
        !iconOnly && maxWidth ? { maxWidth } : null,
        { borderColor, backgroundColor },
      ]}>
      <View style={[styles.controlButtonInner, iconOnly && styles.controlButtonInnerIconOnly]}>
        {loading ? <ActivityIndicator size={16} color={textColor} /> : null}
        {!loading && icon ? icon({ size: 16, color: textColor }) : null}
        {!loading && !icon && iconName ? <MaterialCommunityIcons name={iconName} size={16} color={textColor} /> : null}
        {!iconOnly ? (
          <Text numberOfLines={1} ellipsizeMode="tail" variant="labelLarge" style={[styles.controlButtonLabel, { color: textColor }]}>
            {children}
          </Text>
        ) : null}
      </View>
    </TouchableRipple>
  );
}

export function TopTab({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <TouchableRipple style={styles.topTab} onPress={onPress}>
      <View style={[styles.topTabInner, active && { borderBottomColor: palette.tint, borderBottomWidth: 2 }]}>
        <Text variant="titleMedium" style={{ color: active ? palette.text : palette.muted, fontWeight: active ? '700' : '500' }}>
          {label}
        </Text>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  controlButton: {
    borderRadius: 999,
    borderWidth: 1,
  },
  controlButtonIconOnly: {
    width: 40,
    height: 40,
  },
  controlButtonText: {
    minHeight: 40,
    paddingHorizontal: 12,
  },
  controlButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 38,
  },
  controlButtonInnerIconOnly: {
    gap: 0,
    minHeight: 40,
  },
  controlButtonLabel: {
    flexShrink: 1,
  },
  topTab: { flex: 1 },
  topTabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
});
