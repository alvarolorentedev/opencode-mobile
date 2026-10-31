import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { CardContent, Card } from '@/components/ui/card';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';


import type { PendingPermissionRequest } from '@/lib/opencode/client';


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

  const [submitting, setSubmitting] = useState<'once' | 'always' | 'reject' | undefined>(undefined);

  const handleReply = (reply: 'once' | 'always' | 'reject') => {
    if (submitting) {
      return;
    }
    setSubmitting(reply);
    void onReply(reply).catch(() => undefined).finally(() => setSubmitting(undefined));
  };

  return (
    <Card className={cn(stylesClasses.requestCard, compact && stylesClasses.requestCardCompact, "bg-background")}><CardContent className={cn(stylesClasses.requestCardContent)}><Text className={cn("text-warning")} variant="description">{t('chat:cards.permissionRequest')}</Text>{sourceTitle ? (
          <Text className={cn("text-muted-foreground")} variant="label">{t('chat:cards.requestedBy', { name: sourceTitle })}</Text>
        ) : null}<Text className={cn("text-foreground")} variant="title">{getPermissionTitle(request)}</Text>{request.patterns.length > 0 ? (
          <Text className={cn("text-muted-foreground")} variant="label">{request.patterns.join('\n')}</Text>
        ) : null}<Text className={cn("text-foreground")} variant="label">{t('chat:cards.futureApprovalScope')}</Text><Text className={cn("text-muted-foreground")} variant="label">{request.always.length ? request.always.join('\n') : t('chat:cards.unspecifiedScope')}</Text><Text className={cn("text-muted-foreground")} variant="label">{t('chat:cards.serverRuleDuration')}</Text><View className={cn(stylesClasses.requestActionsRow)}>
          <Button disabled={Boolean(submitting)} onPress={() => handleReply('once')} variant="default">{submitting === 'once' ? <Spinner size="small" /> : null}<Text>{t('chat:cards.allowOnce')}</Text></Button>
          <Button disabled={Boolean(submitting)} onPress={() => handleReply('always')} variant="secondary">{submitting === 'always' ? <Spinner size="small" /> : null}<Text>{t('chat:cards.alwaysAllow')}</Text></Button>
          <Button disabled={Boolean(submitting)} onPress={() => handleReply('reject')} variant="ghost">{submitting === 'reject' ? <Spinner size="small" /> : null}<Text className={cn("text-destructive")} >{t('chat:cards.deny')}</Text></Button>
        </View></CardContent></Card>
  );
}



const stylesClasses = {
  "requestCard": "rounded-[18px]",
  "requestCardCompact": "rounded-[14px]",
  "requestCardContent": "gap-2.5",
  "requestActionsRow": "flex-row flex-wrap gap-2.5"
} as const;
