import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as NativeText, View } from 'react-native';
import { Appbar, Portal, ProgressBar, Text } from 'react-native-paper';

import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';
import { Colors } from '@/constants/theme';
import { getFormatLocale } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/types';
import { formatEstimatedCost, formatTokenCount, type SessionUsage } from '@/lib/opencode/usage';

import { ConversationOverlay } from '@/components/chat/chat-overlay';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { styles } from '@/components/chat/chat-view-styles';
import type { ConversationPhase } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

type ChatHeaderProps = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  conversation: {
    active: boolean;
    latestHeardText?: string;
    phase: ConversationPhase;
    wakePhrase: string;
  };
  insetsTop: number;
  activeProjectLabel?: string;
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
  activeProjectLabel,
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
      <Appbar.Header
        style={[styles.header, { backgroundColor: palette.surface, paddingTop: insetsTop, height: (slim ? 52 : 64) + insetsTop }]}
        statusBarHeight={0}
        elevated>
        <View style={styles.headerMain}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('chat:header.openChats', { title: selectedSession?.title || t('chat:header.untitledChat') })} onPress={onOpenSessionMenu} style={({ pressed }) => [styles.headerSessionAnchor, pressed && styles.headerSessionAnchorPressed]}>
            <View style={styles.headerSessionContent}>
              <View style={styles.headerSessionTextWrap}>
                <Text maxFontSizeMultiplier={1.5} numberOfLines={1} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}>
                  {selectedSession?.title || t('chat:header.untitledChat')}
                </Text>
                <NativeText maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.headerUsage, { color: palette.muted }]}>
                  {activeProjectLabel || t('chat:header.chooseProject')}
                </NativeText>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
            </View>
          </Pressable>
        </View>
        <View style={styles.headerActions}>
          <Appbar.Action icon="plus" accessibilityLabel={t('chat:header.newChat')} onPress={onCreateSession} />
          <Appbar.Action icon={usageIcon} onPress={() => setUsageVisible(true)} accessibilityLabel={t('chat:header.showUsage')} />
        </View>
      </Appbar.Header>
      <Portal>
        {conversation.active ? (
          <ConversationOverlay
            connectionStatus={connectionStatus}
            insetsTop={insetsTop}
            latestUserText={conversation.latestHeardText}
            onStop={onConfirmStopConversation}
            phase={conversation.phase}
            sessionTitle={selectedSession?.title || t('chat:header.untitledChat')}
            wakePhrase={conversation.wakePhrase}
          />
        ) : null}
      </Portal>
      <OverlaySheet visible={usageVisible} title={t('chat:header.sessionUsage')} testID="session-usage-overlay" fitContent onClose={() => setUsageVisible(false)}>
        <Text accessibilityLabel={usageLabel} variant="bodySmall" style={{ color: palette.muted }}>{usageLabel}</Text>
        {usage.completeness && (!usage.completeness.cost || !usage.completeness.tokens) ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:header.partialTotals')}</Text> : null}
        {latestAssistantTurnUsage ? <Text variant="bodySmall" style={{ color: palette.muted }}>{latestAssistantTurnUsage.costStatus === 'pricing-unavailable' ? t('chat:header.lastResponsePricing') : t('chat:header.lastResponseCost', { cost: formatCost(latestAssistantTurnUsage.cost) })}</Text> : null}
        <View style={[styles.usageProvider, { borderColor: palette.border }]}>
          <View style={styles.usageRow}><Text variant="titleSmall" style={{ color: palette.text }}>{t('chat:header.contextUtilization')}</Text><Text accessibilityLabel={contextProgress === undefined ? t('chat:header.contextUnavailable') : t('chat:header.contextPercent', { percent: Math.round(contextProgress * 100) })} variant="titleSmall" style={{ color: palette.text }}>{contextProgress === undefined ? t('common:labels.unavailable') : `${Math.round(contextProgress * 100)}%`}</Text></View>
          {contextProgress === undefined ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:header.noContextLimit')}</Text> : <><View style={{ height: 8, overflow: 'hidden' }}><ProgressBar progress={contextProgress} color={palette.tint} style={styles.contextProgress} /></View><Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:header.inputTokens', { used: formatTokenCount(contextTokens || 0), limit: formatTokenCount(contextLimit || 0) })}</Text></>}
        </View>
        {usage.completeness?.breakdown === false ? <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:header.partialBreakdown')}</Text> : null}
        {usage.completedSteps === 0 ? <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('chat:header.noSteps')}</Text> : null}
        {usage.providers.map((provider) => (
          <View key={provider.providerId} style={[styles.usageProvider, { borderColor: palette.border }]}>
            <View style={styles.usageRow}><Text variant="titleSmall" style={{ color: palette.text }}>{provider.providerId}</Text><Text variant="titleSmall" style={{ color: palette.text }}>{provider.models.some((model) => model.costStatus === 'pricing-unavailable') ? t('chat:header.pricingUnavailable') : formatCost(provider.cost)}</Text></View>
            {provider.models.map((model) => (
              <View key={model.modelId} style={styles.usageModel}>
                <View style={styles.usageRow}><Text variant="bodyMedium" style={{ color: palette.text }}>{model.modelId}</Text><Text accessibilityLabel={t('chat:header.modelCostLabel', { model: model.modelId, cost: model.costStatus === 'pricing-unavailable' ? t('chat:header.pricingUnavailableLower') : formatCost(model.cost) })} variant="bodyMedium" style={{ color: palette.text }}>{model.costStatus === 'pricing-unavailable' ? t('chat:header.includedOrUnpriced') : formatCost(model.cost)}</Text></View>
                <Text accessibilityLabel={t('chat:header.modelTokensLabel', { input: formatTokenCount(model.inputTokens), output: formatTokenCount(model.outputTokens), reasoning: formatTokenCount(model.reasoningTokens), cacheRead: formatTokenCount(model.cacheReadTokens), cacheWrite: formatTokenCount(model.cacheWriteTokens), steps: model.completedSteps })} variant="bodySmall" style={{ color: palette.muted }}>
                  {t('chat:header.modelTokens', { input: formatTokenCount(model.inputTokens), output: formatTokenCount(model.outputTokens), reasoning: formatTokenCount(model.reasoningTokens), cacheRead: formatTokenCount(model.cacheReadTokens), cacheWrite: formatTokenCount(model.cacheWriteTokens), steps: model.completedSteps })}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </OverlaySheet>
    </>
  );
}
