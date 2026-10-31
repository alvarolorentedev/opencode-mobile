import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { CardContent, Card } from '@/components/ui/card';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


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
    <Card className={cn(stylesClasses.sectionCard, "bg-surface")}><CardContent className={cn(stylesClasses.pendingInteractionsContent)}><View className={cn(stylesClasses.waitingNoticeHeader)}>
          <MaterialCommunityIcons name="message-alert-outline" size={18} color={palette.warning} />
          <Text className={cn("text-foreground")} variant="title">{t('chat:cards.respondToContinue')}</Text>
        </View><Text className={cn("text-muted-foreground")} variant="label">{t('chat:cards.waitingForAnswer')}</Text>{permissions.map((request) => (
          <PermissionRequestCard
            key={request.id}
            request={request}
            sourceTitle={request.sourceTitle}
            onReply={(reply) => onPermissionReply(request.id, reply)}
          />
        ))}</CardContent></Card>
  );
}



const stylesClasses = {
  "sectionCard": "rounded-[20px]",
  "pendingInteractionsContent": "gap-3",
  "waitingNoticeHeader": "flex-row items-center gap-2.5"
} as const;
