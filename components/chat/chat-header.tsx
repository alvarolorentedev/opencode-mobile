import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text as NativeText, View } from 'react-native';
import { useState } from 'react';
import { Appbar, Portal, ProgressBar, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { getSessionSubtitle } from '@/lib/opencode/format';
import type { Session } from '@/lib/opencode/types';
import { formatEstimatedCost, formatTokenCount, type SessionUsage } from '@/lib/opencode/usage';

import { ConversationOverlay } from '@/components/chat/chat-overlay';
import { styles } from '@/components/chat/chat-view-styles';
import type { ConversationPhase } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

type ChatHeaderProps = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  conversation: {
    active: boolean;
    latestHeardText?: string;
    phase: ConversationPhase;
  };
  insetsTop: number;
  isCreatingSession: boolean;
  onCloseMenu: () => void;
  onConfirmStopConversation: () => void;
  onCreateSession: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSessionMenu: () => void;
  onToggleConversationMode: () => void;
  palette: Palette;
  selectedSession?: Session;
  sessionMenuVisible: boolean;
  sessions: Session[];
  currentSessionId?: string;
  contextLimit?: number;
  contextTokens?: number;
  isUsageLoading: boolean;
  latestAssistantTurnUsage?: SessionUsage;
  usage: SessionUsage;
};

export function ChatHeader({
  connectionStatus,
  conversation,
  currentSessionId,
  contextLimit,
  contextTokens,
  isUsageLoading,
  insetsTop,
  isCreatingSession,
  onCloseMenu,
  onConfirmStopConversation,
  onCreateSession,
  onOpenSession,
  onOpenSessionMenu,
  onToggleConversationMode,
  palette,
  selectedSession,
  sessionMenuVisible,
  sessions,
  latestAssistantTurnUsage,
  usage,
}: ChatHeaderProps) {
  const [usageVisible, setUsageVisible] = useState(false);
  const usageLabel = usage.costStatus === 'pricing-unavailable' ? 'Pricing unavailable' : `Estimated API cost ${formatEstimatedCost(usage.cost)}`;
  const lastResponseLabel = latestAssistantTurnUsage
    ? latestAssistantTurnUsage.costStatus === 'pricing-unavailable' ? 'Last response: Pricing unavailable' : `Last response: ${formatEstimatedCost(latestAssistantTurnUsage.cost)}`
    : undefined;
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
        style={[styles.header, { backgroundColor: palette.surface, paddingTop: insetsTop, height: 64 + insetsTop }]}
        statusBarHeight={0}
        elevated>
        <View style={styles.headerMain}>
          <Pressable onPress={onOpenSessionMenu} style={({ pressed }) => [styles.headerSessionAnchor, pressed && styles.headerSessionAnchorPressed]}>
            <View style={styles.headerSessionContent}>
              <View style={styles.headerSessionTextWrap}>
                <Text numberOfLines={1} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}> 
                  {selectedSession?.title || 'Untitled chat'}
                </Text>
                <NativeText accessibilityLabel={usageLabel} numberOfLines={1} style={[styles.headerUsage, { color: palette.muted }]}>
                  {isUsageLoading ? 'Loading usage...' : [usageLabel, lastResponseLabel].filter(Boolean).join('  |  ')}
                </NativeText>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
            </View>
          </Pressable>
        </View>
        <View style={styles.headerActions}>
          <Appbar.Action icon="plus" onPress={onCreateSession} disabled={isCreatingSession || connectionStatus !== 'connected'} />
          <Appbar.Action icon={usageIcon} onPress={() => setUsageVisible(true)} accessibilityLabel="Show session usage details" />
          <Appbar.Action
            icon={conversation.active ? 'phone-hangup' : 'headset'}
            onPress={onToggleConversationMode}
            disabled={connectionStatus !== 'connected' || isCreatingSession}
          />
        </View>
      </Appbar.Header>
      <Portal>
        {sessionMenuVisible ? (
          <View style={styles.sessionPickerOverlay}>
            <Pressable onPress={onCloseMenu} style={styles.sessionPickerBackdrop}>
              <View style={styles.sessionPickerBackdropFill} />
            </Pressable>
            <View
              style={[
                styles.sessionPickerSheet,
                {
                  top: 64 + insetsTop,
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={[styles.sessionPickerHeader, { borderBottomColor: palette.border }]}> 
                <Text variant="titleMedium" style={{ color: palette.text }}>Chats</Text>
                <Pressable onPress={onCloseMenu} style={({ pressed }) => [styles.sessionPickerCloseButton, pressed && styles.sessionPickerCloseButtonPressed]}>
                  <NativeText style={[styles.sessionPickerCloseLabel, { color: palette.tint }]}>Close</NativeText>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.sessionPickerList} keyboardShouldPersistTaps="handled">
                {sessions.length === 0 ? <Text variant="bodyMedium" style={{ color: palette.muted }}>No chats yet.</Text> : null}
                {sessions.map((session) => {
                  const isSelected = session.id === currentSessionId;

                  return (
                    <Pressable
                      key={session.id}
                      onPress={() => onOpenSession(session.id)}
                      style={({ pressed }) => [
                        styles.sessionPickerItem,
                        {
                          backgroundColor: isSelected ? palette.background : 'transparent',
                          borderColor: isSelected ? palette.tint : palette.border,
                          opacity: pressed ? 0.82 : 1,
                        },
                      ]}>
                      <View style={styles.sessionPickerItemRow}>
                        <View style={[styles.sessionPickerItemIcon, { backgroundColor: `${(isSelected ? palette.tint : palette.muted)}14` }]}> 
                          <MaterialCommunityIcons name={isSelected ? 'check-circle' : 'message-outline'} size={18} color={isSelected ? palette.tint : palette.muted} />
                        </View>
                        <View style={styles.sessionPickerItemTextWrap}>
                          <NativeText style={[styles.sessionPickerItemTitle, { color: palette.text, fontWeight: isSelected ? '700' : '600' }]}> 
                            {session.title || 'Untitled chat'}
                          </NativeText>
                          <NativeText style={[styles.sessionPickerItemSubtitle, { color: palette.muted }]}>
                            {getSessionSubtitle(session)}
                          </NativeText>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        ) : null}
        {conversation.active ? (
          <ConversationOverlay
            connectionStatus={connectionStatus}
            insetsTop={insetsTop}
            latestUserText={conversation.latestHeardText}
            onStop={onConfirmStopConversation}
            phase={conversation.phase}
            sessionTitle={selectedSession?.title || 'Untitled chat'}
          />
        ) : null}
        {usageVisible ? (
          <View style={styles.sessionPickerOverlay}>
            <Pressable onPress={() => setUsageVisible(false)} style={styles.sessionPickerBackdrop}><View style={styles.sessionPickerBackdropFill} /></Pressable>
            <View style={[styles.sessionPickerSheet, { top: 64 + insetsTop, backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={[styles.sessionPickerHeader, { borderBottomColor: palette.border }]}>
                <View>
                  <Text variant="titleMedium" style={{ color: palette.text }}>Session usage</Text>
                  <Text accessibilityLabel={usageLabel} variant="bodySmall" style={{ color: palette.muted }}>{usageLabel}</Text>
                </View>
                <Pressable onPress={() => setUsageVisible(false)} style={styles.sessionPickerCloseButton}><NativeText style={[styles.sessionPickerCloseLabel, { color: palette.tint }]}>Close</NativeText></Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.sessionPickerList}>
                <View style={[styles.usageProvider, { borderColor: palette.border }]}>
                  <View style={styles.usageRow}><Text variant="titleSmall" style={{ color: palette.text }}>Context utilization</Text><Text accessibilityLabel={contextProgress === undefined ? 'Context utilization unavailable' : `${Math.round(contextProgress * 100)} percent context utilization`} variant="titleSmall" style={{ color: palette.text }}>{contextProgress === undefined ? 'Unavailable' : `${Math.round(contextProgress * 100)}%`}</Text></View>
                  {contextProgress === undefined ? <Text variant="bodySmall" style={{ color: palette.muted }}>OpenCode did not provide a context limit for this model.</Text> : <><ProgressBar progress={contextProgress} color={palette.tint} style={styles.contextProgress} /><Text variant="bodySmall" style={{ color: palette.muted }}>{`${formatTokenCount(contextTokens || 0)} of ${formatTokenCount(contextLimit || 0)} input tokens`}</Text></>}
                </View>
                {usage.completedSteps === 0 ? <Text variant="bodyMedium" style={{ color: palette.muted }}>No completed inference steps yet.</Text> : null}
                {usage.providers.map((provider) => (
                  <View key={provider.providerId} style={[styles.usageProvider, { borderColor: palette.border }]}>
                    <View style={styles.usageRow}><Text variant="titleSmall" style={{ color: palette.text }}>{provider.providerId}</Text><Text variant="titleSmall" style={{ color: palette.text }}>{provider.models.some((model) => model.costStatus === 'pricing-unavailable') ? 'Pricing unavailable' : formatEstimatedCost(provider.cost)}</Text></View>
                    {provider.models.map((model) => (
                      <View key={model.modelId} style={styles.usageModel}>
                        <View style={styles.usageRow}><Text variant="bodyMedium" style={{ color: palette.text }}>{model.modelId}</Text><Text accessibilityLabel={`${model.modelId} cost ${model.costStatus === 'pricing-unavailable' ? 'pricing unavailable' : formatEstimatedCost(model.cost)}`} variant="bodyMedium" style={{ color: palette.text }}>{model.costStatus === 'pricing-unavailable' ? 'Included or unpriced' : formatEstimatedCost(model.cost)}</Text></View>
                        <Text accessibilityLabel={`${formatTokenCount(model.inputTokens)} input tokens, ${formatTokenCount(model.outputTokens)} output tokens, ${formatTokenCount(model.reasoningTokens)} reasoning tokens, ${formatTokenCount(model.cacheReadTokens)} cache read tokens, ${formatTokenCount(model.cacheWriteTokens)} cache write tokens, ${model.completedSteps} completed steps`} variant="bodySmall" style={{ color: palette.muted }}>
                          {`${formatTokenCount(model.inputTokens)} in  ${formatTokenCount(model.outputTokens)} out  ${formatTokenCount(model.reasoningTokens)} reasoning  ${formatTokenCount(model.cacheReadTokens)} cache read  ${formatTokenCount(model.cacheWriteTokens)} cache write  ${model.completedSteps} steps`}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </Portal>
    </>
  );
}
