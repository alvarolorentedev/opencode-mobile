import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { usePalette } from '@/providers/theme-provider';
export type SwipeRowAction = { label: string; icon: ComponentProps<typeof MaterialCommunityIcons>['name']; onPress: () => void };

export function SwipeRow({ children, actions, title }: { children: ReactNode; actions: SwipeRowAction[]; title: string }) {
  const [width, setWidth] = useState(0);
  const palette = usePalette();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.row} contentContainerStyle={styles.content}>
    <View style={[styles.rowContent, { width: width || '100%' }]}>{children}</View>
    <View style={styles.actions}>{actions.map((action) => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={`${action.label} ${title}`} onPress={action.onPress} style={[styles.action, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
      <MaterialCommunityIcons name={action.icon} size={20} color={palette.text} /><Text style={[styles.label, { color: palette.text }]}>{action.label}</Text>
    </Pressable>)}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  row: { width: '100%', flexGrow: 0 },
  rowContent: { overflow: 'hidden' },
  content: { alignItems: 'stretch' },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 4, paddingLeft: 6 },
  action: { width: 76, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 14, borderWidth: 1 },
  label: { fontSize: 11, fontWeight: '600' },
});
