import { View } from 'react-native';
import { Chip, IconButton, Surface, Text, TextInput, Card, Checkbox } from 'react-native-paper';
import { useEffect, useState } from 'react';

import { Colors } from '@/constants/theme';
import { ControlButton, SelectControl } from '@/components/chat/chat-controls';
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
  onAttach: () => void;
  onDraftChange: (value: string) => void;
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
  currentTodos?: any[];
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
  onAttach,
  onDraftChange,
  onRemoveAttachment,
  onSend,
  onToggleAutoApprove,
  onToggleRecording,
  palette,
  selectedAgentLabel,
  showSendAction,
  updateChatPreferences,
  visibleModels,
   currentTodos,
   }: ChatComposerProps) {
  const minInputHeight = 24;
  const maxInputHeight = 110;
  const hasComposerContent = Boolean(draft.trim()) || attachments.length > 0;
  const showOuterAction = showSendAction ? (hasComposerContent ? 'send' : 'attach') : 'stop';
  const outerActionIcon = showOuterAction === 'attach' ? 'plus' : showOuterAction;
  const outerActionDisabled =
    showOuterAction === 'attach'
      ? false
      : showOuterAction === 'send'
        ? ((!draft.trim() && attachments.length === 0) || connectionStatus !== 'connected' || isCreatingSession || isSpeechInputListening)
        : !currentSessionId || isStoppingSession;
  const innerActionIcon = hasComposerContent ? 'paperclip' : (isSpeechInputListening ? 'microphone-off' : 'microphone');
  const innerActionDisabled = hasComposerContent
    ? false
    : conversation.active || connectionStatus !== 'connected' || (!isSpeechInputListening && !isSpeechInputAvailable);
  const handleOuterActionPress = showOuterAction === 'attach' ? onAttach : onSend;
  const handleInnerActionPress = hasComposerContent ? onAttach : onToggleRecording;

  const [todosCollapsed, setTodosCollapsed] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [inputHeight, setInputHeight] = useState(minInputHeight);

  useEffect(() => {
    if (!currentTodos) {
      setCheckedIds({});
      return;
    }

    const next: Record<string, boolean> = {};
    for (const t of currentTodos) {
      if (t && t.id) next[t.id] = t.status === 'completed';
    }
    setCheckedIds(next);
  }, [currentTodos]);

  const completedCount = currentTodos ? currentTodos.filter((t: any) => t && t.status === 'completed').length : 0;

  return (
    <Surface
      style={[styles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insetsBottom, 12) }]}
      elevation={4}>
      <View style={styles.controlsRow}>
        <SelectControl
          disabled={availableAgents.length === 0}
          grow
          iconName="robot-outline"
          label={selectedAgentLabel}
          onValueChange={(value) => updateChatPreferences({ mode: value })}
          options={availableAgents.map((agent) => ({ value: agent.id, label: agent.label }))}
          selectedValue={chatPreferences.mode}
          title="Choose assistant mode"
        />
        <SelectControl
          disabled={visibleModels.length === 0}
          grow
          icon={(props) => renderProviderIcon(visibleModels.find((model) => model.id === chatPreferences.modelId)?.providerID, props.size, props.color)}
          label={getModelLabel(visibleModels, chatPreferences.modelId)}
          onValueChange={(value) => {
            const model = visibleModels.find((item) => item.id === value);
            if (!model) {
              return;
            }
            updateChatPreferences({ providerId: model.providerID, modelId: model.id });
          }}
          options={visibleModels.map((model) => ({
            description: model.supportsReasoning ? 'Reasoning supported' : 'Standard model',
            label: model.label,
            leadingIcon: (props) => renderProviderIcon(model.providerID, props.size, props.color),
            value: model.id,
          }))}
          selectedValue={chatPreferences.modelId}
          title="Choose model"
        />
        <SelectControl
          grow
          iconName="brain"
          label={chatPreferences.reasoning}
          onValueChange={(value) => updateChatPreferences({ reasoning: value })}
          options={REASONING_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          selectedValue={chatPreferences.reasoning}
          title="Choose reasoning level"
        />
        <ControlButton active={chatPreferences.autoApprove} iconName={getAutoApproveIcon(chatPreferences.autoApprove)} iconOnly loading={isUpdatingAutoApprove} onPress={onToggleAutoApprove}>
          {chatPreferences.autoApprove ? 'Auto approve enabled' : 'Ask permission'}
        </ControlButton>
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

      {currentTodos && currentTodos.length > 0 ? (
        <Card mode="contained" style={[styles.todoCard, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
          <Card.Content style={styles.todoHeader}>
            <Text variant="bodyLarge" style={{ color: palette.text }}>{`${completedCount} of ${currentTodos.length} todos completed`}</Text>
            <IconButton icon={todosCollapsed ? 'chevron-up' : 'chevron-down'} size={20} onPress={() => setTodosCollapsed((c) => !c)} />
          </Card.Content>

          {!todosCollapsed ? (
            <Card.Content style={styles.todoList}>
              {currentTodos.map((todo, idx) => (
                <View key={todo.id || `${idx}`} style={styles.todoItemRow}>
                  <Checkbox.Android
                    status={checkedIds[todo.id] ? 'checked' : 'unchecked'}
                    onPress={() => setCheckedIds((s) => ({ ...s, [todo.id]: !s[todo.id] }))}
                  />
                  <View style={styles.todoTextWrap}>
                    <Text variant="bodyMedium" style={{ color: palette.text }}>{todo.content || 'Untitled todo'}</Text>
                    {todo.priority ? <Text variant="bodySmall" style={{ color: palette.muted }}>{todo.priority}</Text> : null}
                  </View>
                </View>
              ))}
            </Card.Content>
          ) : null}
        </Card>
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

      <View style={styles.composerDockRow}>
        <View style={[styles.inputShell, styles.inputShellFlex, { borderColor: palette.border, backgroundColor: palette.background }]}>
          <View style={styles.composerRow}>
            <TextInput
               testID="chat-prompt-input"
               mode="flat"
               dense
               value={draft}
               onChangeText={onDraftChange}
               onContentSizeChange={({ nativeEvent }) => {
                 const nextHeight = Math.min(maxInputHeight, Math.max(minInputHeight, Math.ceil(nativeEvent.contentSize.height)));
                 setInputHeight((current) => (current === nextHeight ? current : nextHeight));
               }}
               editable={!isSpeechInputListening}
               multiline
               scrollEnabled={false}
               placeholder="Ask anything..."
               placeholderTextColor={palette.muted}
               style={[styles.input, { height: inputHeight, backgroundColor: 'transparent', color: palette.text }]}
               contentStyle={styles.inputContentCompact}
               underlineColor="transparent"
               activeUnderlineColor="transparent"
               textAlignVertical="top"
             />

            <IconButton
              testID="chat-secondary-button"
              icon={innerActionIcon}
              size={20}
              selected={!hasComposerContent && isSpeechInputListening}
              style={styles.composerVoiceButton}
              disabled={innerActionDisabled}
              onPress={handleInnerActionPress}
            />
          </View>
        </View>

        <IconButton
          testID="chat-primary-button"
          mode="contained"
          icon={outerActionIcon}
          size={20}
          style={styles.composerPrimaryButton}
          containerColor={palette.tint}
          iconColor={palette.surface}
          loading={showOuterAction === 'stop' && isStoppingSession}
          disabled={outerActionDisabled}
          onPress={handleOuterActionPress}
        />
      </View>
    </Surface>
  );
}
