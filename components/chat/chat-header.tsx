import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Portal } from '@/components/ui/portal';
import { Progress } from '@/components/ui/progress';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';


import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';
import { Colors } from '@/constants/theme';
import { getFormatLocale } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/types';
import { formatEstimatedCost, formatTokenCount, type SessionUsage } from '@/lib/opencode/usage';

import { ConversationOverlay } from '@/components/chat/chat-overlay';
import { ChatWorkspaceContext } from '@/components/chat/chat-workspace-context';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { styles , stylesClasses} from '@/components/chat/chat-view-styles';
import type { ConversationConfirmationState, ConversationInputPhase, ConversationPhase, ConversationReadbackPhase } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

type ChatHeaderProps = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  conversation: {
    active: boolean;
    confirmation?: ConversationConfirmationState;
    feedback?: string;
    inputPhase: ConversationInputPhase;
    latestHeardText?: string;
    level: number;
    phase: ConversationPhase;
    readbackPhase: ConversationReadbackPhase;
    wakePhrase: string;
  };
  insetsTop: number;
  onConfirmStopConversation: () => void;
  onCreateSession: () => void;
  onOpenSessionMenu: () => void;
  palette: Palette;
  selectedSession?: Session;
  contextLimit?: number;
  contextTokens?: number;
  latestAssistantTurnUsage?: SessionUsage;
  slim?: boolean;
  usage: SessionUsage;
};

export function ChatHeader({
  connectionStatus,
  conversation,
  contextLimit,
  contextTokens,
  insetsTop,
  onConfirmStopConversation,
  onCreateSession,
  onOpenSessionMenu,
  palette,
  selectedSession,
  latestAssistantTurnUsage,
  slim = false,
  usage,
}: ChatHeaderProps) {
  const { t } = useTranslation();
  const formatCost = (value: number) => formatEstimatedCost(value, 'USD', getFormatLocale());
  const [usageVisible, setUsageVisible] = useState(false);
  // Android back stops conversation mode instead of leaving the screen.
  useDismissOnBack(conversation.active, onConfirmStopConversation);
  const usageLabel = usage.costStatus === 'pricing-unavailable' ? t('chat:header.pricingUnavailable') : t('chat:header.estimatedCost', { cost: formatCost(usage.cost) });
  const contextProgress = contextLimit && contextTokens !== undefined ? Math.min(contextTokens / contextLimit, 1) : undefined;
  const usageIcon = contextProgress === undefined
    ? 'circle-outline'
    : contextProgress <= 0.25
      ? 'circle-slice-1'
      : contextProgress <= 0.5
        ? 'circle-slice-2'
        : contextProgress <= 0.75
          ? 'circle-slice-3'
          : 'circle-slice-4';
  return (
    <>
      <ScreenHeader style={[styles.header, { backgroundColor: palette.surface, paddingTop: insetsTop, height: (slim ? 52 : 64) + insetsTop }]} safeArea={false}><View className={cn(stylesClasses.headerMain)}>
          <View className={cn(stylesClasses.headerSessionTextWrap)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat:header.openChats', { title: selectedSession?.title || t('chat:header.untitledChat') })}
              hitSlop={{ top: 6, left: 6, right: 6 }}
              onPress={onOpenSessionMenu}
              style={({ pressed }) => [styles.headerSessionAnchor, pressed && styles.headerSessionAnchorPressed]}>
              <Text maxFontSizeMultiplier={1.5} numberOfLines={1} className={cn("text-foreground")} style={[styles.headerTitle]} variant="title">{selectedSession?.title || t('chat:header.untitledChat')}</Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
            </Pressable>
            <ChatWorkspaceContext compact={slim} />
          </View>
        </View><View className={cn(stylesClasses.headerActions)}>
          <Button accessibilityLabel={t('chat:header.newChat')} onPress={onCreateSession} variant="ghost" size="icon"><Icon name={"plus"} size={24} /></Button>
          <Button onPress={() => setUsageVisible(true)} accessibilityLabel={t('chat:header.showUsage')} variant="ghost" size="icon"><Icon name={usageIcon} size={24} /></Button>
        </View></ScreenHeader>
      <Portal>{conversation.active ? (
          <ConversationOverlay
            confirmation={conversation.confirmation}
            connectionStatus={connectionStatus}
            feedback={conversation.feedback}
            inputPhase={conversation.inputPhase}
            insetsTop={insetsTop}
            latestUserText={conversation.latestHeardText}
            level={conversation.level}
            onStop={onConfirmStopConversation}
            phase={conversation.phase}
            readbackPhase={conversation.readbackPhase}
            sessionTitle={selectedSession?.title || t('chat:header.untitledChat')}
            wakePhrase={conversation.wakePhrase}
          />
        ) : null}</Portal>
      <OverlaySheet visible={usageVisible} title={t('chat:header.sessionUsage')} testID="session-usage-overlay" fitContent onClose={() => setUsageVisible(false)}>
        <Text accessibilityLabel={usageLabel} className={cn("text-muted-foreground")} variant="label">{usageLabel}</Text>
        {usage.completeness && (!usage.completeness.cost || !usage.completeness.tokens) ? <Text className={cn("text-muted-foreground")} variant="label">{t('chat:header.partialTotals')}</Text> : null}
        {latestAssistantTurnUsage ? <Text className={cn("text-muted-foreground")} variant="label">{latestAssistantTurnUsage.costStatus === 'pricing-unavailable' ? t('chat:header.lastResponsePricing') : t('chat:header.lastResponseCost', { cost: formatCost(latestAssistantTurnUsage.cost) })}</Text> : null}
        <View className={cn(stylesClasses.usageProvider, "border-border")}>
          <View className={cn(stylesClasses.usageRow)}><Text className={cn("text-foreground")} variant="description">{t('chat:header.contextUtilization')}</Text><Text accessibilityLabel={contextProgress === undefined ? t('chat:header.contextUnavailable') : t('chat:header.contextPercent', { percent: Math.round(contextProgress * 100) })} className={cn("text-foreground")} variant="description">{contextProgress === undefined ? t('common:labels.unavailable') : `${Math.round(contextProgress * 100)}%`}</Text></View>
          {contextProgress === undefined ? <Text className={cn("text-muted-foreground")} variant="label">{t('chat:header.noContextLimit')}</Text> : <><View className={cn("h-2 overflow-hidden")}><Progress className={cn(stylesClasses.contextProgress)} value={(contextProgress) * 100}></Progress></View><Text className={cn("text-muted-foreground")} variant="label">{t('chat:header.inputTokens', { used: formatTokenCount(contextTokens || 0), limit: formatTokenCount(contextLimit || 0) })}</Text></>}
        </View>
        {usage.completeness?.breakdown === false ? <Text className={cn("text-muted-foreground")} variant="label">{t('chat:header.partialBreakdown')}</Text> : null}
        {usage.completedSteps === 0 ? <Text className={cn("text-muted-foreground")} variant="description">{t('chat:header.noSteps')}</Text> : null}
        {usage.providers.map((provider) => (
          <View key={provider.providerId} className={cn(stylesClasses.usageProvider, "border-border")}>
            <View className={cn(stylesClasses.usageRow)}><Text className={cn("text-foreground")} variant="description">{provider.providerId}</Text><Text className={cn("text-foreground")} variant="description">{provider.models.some((model) => model.costStatus === 'pricing-unavailable') ? t('chat:header.pricingUnavailable') : formatCost(provider.cost)}</Text></View>
            {provider.models.map((model) => (
              <View key={model.modelId} className={cn(stylesClasses.usageModel)}>
                <View className={cn(stylesClasses.usageRow)}><Text className={cn("text-foreground")} variant="description">{model.modelId}</Text><Text accessibilityLabel={t('chat:header.modelCostLabel', { model: model.modelId, cost: model.costStatus === 'pricing-unavailable' ? t('chat:header.pricingUnavailableLower') : formatCost(model.cost) })} className={cn("text-foreground")} variant="description">{model.costStatus === 'pricing-unavailable' ? t('chat:header.includedOrUnpriced') : formatCost(model.cost)}</Text></View>
                <Text accessibilityLabel={t('chat:header.modelTokensLabel', { input: formatTokenCount(model.inputTokens), output: formatTokenCount(model.outputTokens), reasoning: formatTokenCount(model.reasoningTokens), cacheRead: formatTokenCount(model.cacheReadTokens), cacheWrite: formatTokenCount(model.cacheWriteTokens), steps: model.completedSteps })} className={cn("text-muted-foreground")} variant="label">{t('chat:header.modelTokens', { input: formatTokenCount(model.inputTokens), output: formatTokenCount(model.outputTokens), reasoning: formatTokenCount(model.reasoningTokens), cacheRead: formatTokenCount(model.cacheReadTokens), cacheWrite: formatTokenCount(model.cacheWriteTokens), steps: model.completedSteps })}</Text>
              </View>
            ))}
          </View>
        ))}
      </OverlaySheet>
    </>
  );
}
