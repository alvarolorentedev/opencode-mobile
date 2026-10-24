import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Card, Text } from 'react-native-paper';

import type { PendingPermission } from '@/lib/opencode/client';
import { PermissionRequestCard } from './permission-request-card';
import { usePalette } from '@/hooks/use-palette';

export function PendingInteractionsCard({
  onPermissionReply,
  permissions,
}: {
  onPermissionReply: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  permissions: PendingPermission[];
}) {
  const { t } = useTranslation();
  const palette = usePalette();

  return (
    <Card mode="contained" style={[styles.sectionCard, { backgroundColor: palette.surface }]}> 
      <Card.Content style={styles.pendingInteractionsContent}>
        <View style={styles.waitingNoticeHeader}>
          <MaterialCommunityIcons name="message-alert-outline" size={18} color={palette.warning} />
          <Text variant="titleMedium" style={{ color: palette.text }}>{t('chat:cards.respondToContinue')}</Text>
        </View>
        <Text variant="bodySmall" style={{ color: palette.muted }}>
          {t('chat:cards.waitingForAnswer')}
        </Text>
        {permissions.map((request) => (
          <PermissionRequestCard
            key={request.id}
            request={request}
            sourceTitle={request.sourceTitle}
            onReply={(reply) => onPermissionReply(request.id, reply)}
          />
        ))}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionCard: { borderRadius: 20 },
  pendingInteractionsContent: { gap: 12 },
  waitingNoticeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
