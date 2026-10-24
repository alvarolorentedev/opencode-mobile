import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';

import type { PendingPermissionRequest } from '@/lib/opencode/client';
import { usePalette } from '@/hooks/use-palette';

function getPermissionTitle(request: PendingPermissionRequest) {
  return request.permission
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function PermissionRequestCard({
  compact = false,
  onReply,
  request,
  sourceTitle,
}: {
  compact?: boolean;
  onReply: (reply: 'once' | 'always' | 'reject') => Promise<void>;
  request: PendingPermissionRequest;
  sourceTitle?: string;
}) {
  const { t } = useTranslation();
  const palette = usePalette();
  const [submitting, setSubmitting] = useState<'once' | 'always' | 'reject' | undefined>(undefined);

  const handleReply = (reply: 'once' | 'always' | 'reject') => {
    if (submitting) {
      return;
    }
    setSubmitting(reply);
    void onReply(reply).catch(() => undefined).finally(() => setSubmitting(undefined));
  };

  return (
    <Card mode="contained" style={[styles.requestCard, compact && styles.requestCardCompact, { backgroundColor: palette.background }]}> 
      <Card.Content style={styles.requestCardContent}>
        <Text variant="labelLarge" style={{ color: palette.warning }}>{t('chat:cards.permissionRequest')}</Text>
        {sourceTitle ? (
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:cards.requestedBy', { name: sourceTitle })}</Text>
        ) : null}
        <Text variant="titleMedium" style={{ color: palette.text }}>{getPermissionTitle(request)}</Text>
        {request.patterns.length > 0 ? (
          <Text variant="bodySmall" style={{ color: palette.muted }}>{request.patterns.join('\n')}</Text>
        ) : null}
        <Text variant="labelMedium" style={{ color: palette.text }}>{t('chat:cards.futureApprovalScope')}</Text>
        <Text variant="bodySmall" style={{ color: palette.muted }}>{request.always.length ? request.always.join('\n') : t('chat:cards.unspecifiedScope')}</Text>
        <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:cards.serverRuleDuration')}</Text>
        <View style={styles.requestActionsRow}>
          <Button mode="contained" compact disabled={Boolean(submitting)} loading={submitting === 'once'} onPress={() => handleReply('once')}>{t('chat:cards.allowOnce')}</Button>
          <Button mode="contained-tonal" compact disabled={Boolean(submitting)} loading={submitting === 'always'} onPress={() => handleReply('always')}>{t('chat:cards.alwaysAllow')}</Button>
          <Button mode="text" compact textColor={palette.danger} disabled={Boolean(submitting)} loading={submitting === 'reject'} onPress={() => handleReply('reject')}>{t('chat:cards.deny')}</Button>
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  requestCard: { borderRadius: 18 },
  requestCardCompact: { borderRadius: 14 },
  requestCardContent: { gap: 10 },
  requestActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
