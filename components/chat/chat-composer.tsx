import { View } from 'react-native';
import { Chip, IconButton, Menu, Surface, Text, TextInput } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { ControlButton, MenuControl } from '@/components/chat/chat-controls';
import { styles } from '@/components/chat/chat-view-styles';
import { getAutoApproveIcon, getModelLabel, REASONING_OPTIONS } from '@/components/chat/chat-view-utils';
import { renderProviderIcon } from '@/components/ui/provider-icon';
import type { AgentOption, ChatPreferences, ModelOption } from '@/providers/opencode-provider';

type Palette = typeof Colors.light;

type Attachment = { uri: string; mime?: string; filename?: string };

type ChatComposerProps = {
  attachments: Attachment[];
  availableAgents: AgentOption[];
  chatPreferences: ChatPreferences;
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  conversation: { active: boolean; isListening: boolean; phase: string; statusLabel?: string };
  draft: string;
  insetsBottom: number;
  isCreatingSession: boolean;
  isSpeechInputAvailable: boolean;
  isSpeechInputListening: boolean;
  isStoppingSession: boolean;
  isUpdatingAutoApprove: boolean;
  menu?: 'mode' | 'model' | 'reasoning' | 'session';
  onAttach: () => void;
  onDraftChange: (value: string) => void;
  onMenuChange: (menu: 'mode' | 'model' | 'reasoning' | 'session' | undefined) => void;
  onRemoveAttachment: (index: number) => void;
  onSend: () => void;
  onToggleAutoApprove: () => void;
  onToggleRecording: () => void;
  palette: Palette;
  selectedAgentLabel: string;
  showSendAction: boolean;
  currentSessionId?: string;
  visibleModels: ModelOption[];
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
};

export function ChatComposer({
  attachments,
  availableAgents,
  chatPreferences,
  connectionStatus,
  conversation,
  currentSessionId,
  draft,
  insetsBottom,
  isCreatingSession,
  isSpeechInputAvailable,
  isSpeechInputListening,
  isStoppingSession,
  isUpdatingAutoApprove,
  menu,
  onAttach,
  onDraftChange,
  onMenuChange,
  onRemoveAttachment,
  onSend,
  onToggleAutoApprove,
  onToggleRecording,
  palette,
  selectedAgentLabel,
  showSendAction,
  updateChatPreferences,
  visibleModels,
}: ChatComposerProps) {
  return (
    <Surface
      style={[styles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insetsBottom, 12) }]}
      elevation={4}>
      <View style={styles.controlsRow}>
        <MenuControl active={menu === 'mode'} iconName="robot-outline" maxWidth={84} label={selectedAgentLabel} onClose={() => onMenuChange(undefined)} onOpen={() => onMenuChange('mode')}>
          {availableAgents.map((agent) => (
            <Menu.Item
              key={agent.id}
              onPress={() => {
                updateChatPreferences({ mode: agent.id });
                onMenuChange(undefined);
              }}
              title={agent.label}
            />
          ))}
        </MenuControl>
        <MenuControl
          active={menu === 'model'}
          maxWidth={112}
          icon={(props) => renderProviderIcon(visibleModels.find((model) => model.id === chatPreferences.modelId)?.providerID, props.size, props.color)}
          label={getModelLabel(visibleModels, chatPreferences.modelId)}
          onClose={() => onMenuChange(undefined)}
          onOpen={() => onMenuChange('model')}>
          {visibleModels.map((model) => (
            <Menu.Item
              key={model.id}
              leadingIcon={(props) => renderProviderIcon(model.providerID, props.size, props.color)}
              onPress={() => {
                updateChatPreferences({ providerId: model.providerID, modelId: model.id });
                onMenuChange(undefined);
              }}
              title={model.label}
            />
          ))}
        </MenuControl>
        <MenuControl active={menu === 'reasoning'} iconName="brain" maxWidth={84} label={chatPreferences.reasoning} onClose={() => onMenuChange(undefined)} onOpen={() => onMenuChange('reasoning')}>
          {REASONING_OPTIONS.map((option) => (
            <Menu.Item
              key={option.id}
              onPress={() => {
                updateChatPreferences({ reasoning: option.id });
                onMenuChange(undefined);
              }}
              title={option.label}
            />
          ))}
        </MenuControl>
        <ControlButton active={chatPreferences.autoApprove} iconName={getAutoApproveIcon(chatPreferences.autoApprove)} iconOnly loading={isUpdatingAutoApprove} onPress={onToggleAutoApprove}>
          {chatPreferences.autoApprove ? 'Auto approve enabled' : 'Ask permission'}
        </ControlButton>
        <ControlButton iconName="paperclip" iconOnly onPress={onAttach}>Files</ControlButton>
      </View>

      {conversation.active ? (
        <View style={[styles.conversationBanner, { backgroundColor: `${palette.tint}10`, borderColor: `${palette.tint}28` }]}>
          <View style={styles.conversationBannerHeader}>
            <Text variant="labelLarge" style={{ color: palette.text }}>Conversation mode</Text>
            <Chip compact icon={conversation.phase === 'speaking' ? 'volume-high' : 'microphone'}>{conversation.statusLabel || 'Active'}</Chip>
          </View>
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            Keep talking naturally while the app stays open. It listens, sends your turn, reads the reply, and then listens again.
          </Text>
        </View>
      ) : null}

      {attachments.length > 0 ? (
        <View style={styles.attachmentRow}>
          {attachments.map((att, idx) => (
            <Chip key={`${att.uri}-${idx}`} compact mode="flat" style={[styles.attachmentChip, { backgroundColor: palette.background }]} onClose={() => onRemoveAttachment(idx)}>
              {att.filename || att.uri}
            </Chip>
          ))}
        </View>
      ) : null}

      {isSpeechInputListening || conversation.isListening ? (
        <View style={styles.voiceStatusRow}>
          <Chip compact icon="microphone" style={[styles.voiceStatusChip, { backgroundColor: `${palette.tint}14` }]}>
            {conversation.active ? 'Conversation active' : 'Listening'}
          </Chip>
        </View>
      ) : null}

      <View style={[styles.inputShell, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <View style={styles.composerRow}>
          <TextInput
            testID="chat-prompt-input"
            mode="flat"
            value={draft}
            onChangeText={onDraftChange}
            editable={!isSpeechInputListening}
            multiline
            placeholder="Ask anything..."
            placeholderTextColor={palette.muted}
            style={[styles.input, { backgroundColor: 'transparent', color: palette.text }]}
            contentStyle={styles.inputContentCompact}
            underlineColor="transparent"
            activeUnderlineColor="transparent"
          />

          <IconButton
            testID="chat-voice-button"
            icon={isSpeechInputListening ? 'microphone-off' : 'microphone'}
            size={20}
            selected={isSpeechInputListening}
            style={styles.composerVoiceButton}
            disabled={conversation.active || connectionStatus !== 'connected' || (!isSpeechInputListening && !isSpeechInputAvailable)}
            onPress={onToggleRecording}
          />

          <IconButton
            testID="chat-send-button"
            mode="contained"
            icon={showSendAction ? 'send' : 'stop'}
            size={20}
            style={styles.composerActionButton}
            loading={isStoppingSession}
            disabled={showSendAction ? ((!draft.trim() && attachments.length === 0) || connectionStatus !== 'connected' || isCreatingSession || isSpeechInputListening) : !currentSessionId || isStoppingSession}
            onPress={onSend}
          />
        </View>
      </View>
    </Surface>
  );
}
