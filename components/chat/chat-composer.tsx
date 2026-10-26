import { withAlpha } from '@/lib/color';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, useWindowDimensions, View } from 'react-native';
import { Chip, IconButton, Surface, Text } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { TextInput } from '@/components/ui/text-input';
import { NativeSelect } from '@/components/ui/native-select';
import { AttachmentStrip } from '@/components/chat/attachment-strip';
import { ComposerSuggestions } from '@/components/chat/composer-suggestions';
import type { ComposerSuggestion, ComposerSuggestionGroup } from '@/components/chat/composer-suggestion-types';
import { ModelPicker } from '@/components/chat/model-picker';
import { styles, slimStyles } from '@/components/chat/chat-view-styles';
import { getAutoApproveIcon, getModelVariantLabel } from '@/components/chat/chat-view-utils';
import type { AgentOption, ChatPreferences, ModelOption } from '@/providers/opencode-provider';
import type { Command } from '@/lib/opencode/types';

type Palette = typeof Colors.light;

type Attachment = { uri: string; mime?: string; filename?: string };

type ChatComposerProps = {
  attachments: Attachment[];
  availableAgents: AgentOption[];
  chatPreferences: ChatPreferences;
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  conversation: { active: boolean; isListening: boolean; phase: string; statusLabel?: string; wakePhrase: string };
  draft: string;
  isSpeechInputAvailable: boolean;
  isSpeechInputListening: boolean;
  isStoppingSession: boolean;
  isUpdatingAutoApprove: boolean;
  autoApproveAvailable?: boolean;
  onAttach: () => void;
  onDraftChange: (value: string) => void;
  onRemoveAttachment: (index: number) => void;
  onSend: () => void;
  onToggleAutoApprove: () => Promise<boolean>;
  onToggleRecording: () => void;
  onToggleConversationMode: () => void;
  palette: Palette;
  selectedAgentLabel: string;
  showSendAction: boolean;
  selectedVariant?: string;
  slim?: boolean;
  currentSessionId?: string;
  visibleModels: ModelOption[];
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  commands: Command[];
  isV2: boolean;
  suggestions: ComposerSuggestionGroup[];
  suggestionsActive: boolean;
  suggestionsSearching: boolean;
  suggestionsError?: string;
  onSuggestionSelect: (suggestion: ComposerSuggestion) => void;
  onSelectionChange: (selection: { start: number; end: number }) => void;
  shellMode: boolean;
  focusRequest: number;
};

export function ChatComposer({
  attachments,
  availableAgents,
  chatPreferences,
  connectionStatus,
  conversation,
  currentSessionId,
  commands,
  draft,
  isSpeechInputAvailable,
  isSpeechInputListening,
  isStoppingSession,
  isUpdatingAutoApprove,
  autoApproveAvailable = true,
  onAttach,
  onDraftChange,
  onRemoveAttachment,
  onSend,
  onToggleAutoApprove,
  onToggleRecording,
  onToggleConversationMode,
  palette,
  selectedAgentLabel,
  showSendAction,
  selectedVariant,
  slim = false,
  updateChatPreferences,
  visibleModels,
  isV2,
  suggestions,
  suggestionsActive,
  suggestionsSearching,
  suggestionsError,
  onSuggestionSelect,
  onSelectionChange,
  shellMode,
  focusRequest,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const { fontScale } = useWindowDimensions();
  const inputRef = useRef<{ focus: () => void } | null>(null);
  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);
  // iOS grows the native multiline input itself, and Paper's dense container
  // floors that growth at its 40 px minimum, so slim shares the same floor.
  const minInputHeight = slim ? 40 : 44;
  const maxInputHeight = slim ? 90 : 110;
  const hasComposerContent = Boolean(draft.trim()) || attachments.length > 0;
  const primaryAction = !showSendAction ? 'stop' : hasComposerContent ? 'send' : 'voice';
  const primaryDisabled = primaryAction === 'stop'
    ? !currentSessionId || isStoppingSession
    : primaryAction === 'send'
      ? connectionStatus !== 'connected' || isSpeechInputListening
      : connectionStatus !== 'connected' || !isSpeechInputAvailable;
  const selectedModel = visibleModels.find((model) => model.id === chatPreferences.modelId);
  const reasoningLabel = selectedModel?.variants.length ? getModelVariantLabel(selectedVariant, t) : undefined;

  // Android/web size the input from content-size events. iOS lets the native
  // multiline input grow and scroll at the cap instead of measuring a hidden
  // copy, which lagged a layout pass behind the text on device.
  const [inputHeight, setInputHeight] = useState(minInputHeight);
  const displayedInputHeight = draft ? Math.min(maxInputHeight, Math.max(minInputHeight, inputHeight)) : minInputHeight;
  const inputTextStyle = [styles.composerTextArea, slim && { fontSize: 15 }];
  function updateInputHeight(height: number) {
    const nextHeight = Math.min(maxInputHeight, Math.max(minInputHeight, Math.ceil(height)));
    setInputHeight((current) => (current === nextHeight ? current : nextHeight));
  }

  const modelPicker = (
    <ModelPicker
      compact
      reasoningLabel={reasoningLabel}
      selectedVariant={selectedVariant}
      onVariantChange={(variant) => {
        const modelId = chatPreferences.modelId;
        if (modelId) updateChatPreferences({ modelVariantSelections: { [modelId]: variant ?? null } });
      }}
      disabled={visibleModels.length === 0}
      models={visibleModels}
      onSelect={(model) => updateChatPreferences({ providerId: model.providerID, modelId: model.id })}
      recentModelIds={chatPreferences.recentModelIds}
      selectedModelId={chatPreferences.modelId}
      slim={slim}
    />
  );

  return (
    <Surface
      style={[styles.composer, slim && slimStyles.composer, { backgroundColor: palette.background, borderTopWidth: 0 }]}
      elevation={0}>
      {conversation.active ? (
        <View style={[styles.conversationBanner, { backgroundColor: withAlpha(palette.tint, 0x10 / 255), borderColor: withAlpha(palette.tint, 0x28 / 255) }]}>
          <View style={styles.conversationBannerHeader}>
            <Text variant="labelLarge" style={{ color: palette.text }}>{t('chat:composer.conversationMode')}</Text>
            <Chip compact icon={conversation.phase === 'speaking' ? 'volume-high' : 'microphone'}>{conversation.statusLabel || t('common:labels.active')}</Chip>
          </View>
          <Text variant="bodySmall" style={{ color: palette.muted }}>
            {t('chat:composer.conversationHint', { phrase: conversation.wakePhrase })}
          </Text>
        </View>
      ) : null}

      {attachments.length > 0 ? <AttachmentStrip attachments={attachments} onRemove={onRemoveAttachment} /> : null}

      {isV2 && suggestionsActive ? (
        <ComposerSuggestions
          error={suggestionsError}
          groups={suggestions}
          searching={suggestionsSearching}
          onSelect={onSuggestionSelect}
        />
      ) : null}

      {!isV2 && draft.startsWith('/') && !draft.includes(' ') && commands.length > 0 ? (
        <View style={styles.attachmentRow}>
          {commands.filter((command) => command.name.startsWith(draft.slice(1))).slice(0, 6).map((command) => (
            <Chip
              key={command.name}
              compact
              mode="outlined"
              onPress={() => {
                onDraftChange(`/${command.name} `);
              }}>
              /{command.name}
            </Chip>
          ))}
        </View>
      ) : null}

      {isV2 && shellMode ? (
        <View testID="chat-shell-banner" style={[styles.shellBanner, { backgroundColor: withAlpha(palette.tint, 0x10 / 255), borderColor: withAlpha(palette.tint, 0x28 / 255) }]}>
          <Text variant="labelLarge" style={{ color: palette.text }}>{t('chat:composer.shellCommand')}</Text>
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:composer.shellHint')}</Text>
        </View>
      ) : null}

      {isSpeechInputListening || conversation.isListening ? (
        <View style={styles.voiceStatusRow}>
          <Chip compact icon="microphone" style={[styles.voiceStatusChip, { backgroundColor: withAlpha(palette.tint, 0x14 / 255) }]}>
            {conversation.active ? t('chat:composer.conversationActive') : t('chat:composer.listening')}
          </Chip>
        </View>
      ) : null}

      <View testID="chat-composer-card" style={[styles.composerCard, slim && { borderRadius: 22 }, { backgroundColor: palette.surfaceAlt }]}>
        <TextInput
          ref={inputRef as unknown as ComponentProps<typeof TextInput>['ref']}
          testID="chat-prompt-input"
          mode="flat"
          dense
          value={draft}
          onChangeText={onDraftChange}
          onSelectionChange={({ nativeEvent }) => onSelectionChange(nativeEvent.selection)}
          onContentSizeChange={Platform.OS === 'ios' ? undefined : ({ nativeEvent }) => updateInputHeight(nativeEvent.contentSize.height)}
          editable={!isSpeechInputListening}
          multiline
          scrollEnabled={Platform.OS === 'ios' ? true : displayedInputHeight >= maxInputHeight}
          placeholder={t('chat:composer.placeholder')}
          placeholderTextColor={palette.muted}
          style={[
            inputTextStyle,
            Platform.OS === 'ios'
              // Let the platform size the multiline input and scroll at the cap.
              ? { minHeight: minInputHeight, maxHeight: maxInputHeight, color: palette.text }
              : { height: displayedInputHeight, color: palette.text },
          ]}
          contentStyle={Platform.OS === 'ios' ? [styles.inputContentCompact, { minHeight: minInputHeight, maxHeight: maxInputHeight }] : styles.inputContentCompact}
          underlineColor="transparent"
          activeUnderlineColor="transparent"
          textAlignVertical="top"
        />
        {fontScale > 1.3 ? <View>{modelPicker}</View> : null}
        <View style={styles.composerToolbar}>
          <IconButton
            testID="chat-attach-button"
            accessibilityLabel={t('chat:composer.attachFiles')}
            icon="plus"
            size={24}
            iconColor={palette.text}
            containerColor="transparent"
            style={styles.composerActionButton}
            onPress={onAttach}
          />
          {autoApproveAvailable ? (
            <IconButton
              testID="chat-approve-button"
              accessibilityLabel={`${t('chat:composer.approvals')}: ${chatPreferences.autoApprove ? t('chat:composer.autoApproveEnabled') : t('chat:composer.askPermission')}`}
              accessibilityState={{ checked: chatPreferences.autoApprove }}
              icon={getAutoApproveIcon(chatPreferences.autoApprove)}
              size={22}
              iconColor={chatPreferences.autoApprove ? palette.warning : palette.text}
              containerColor="transparent"
              style={styles.composerActionButton}
              disabled={isUpdatingAutoApprove}
              loading={isUpdatingAutoApprove}
              onPress={() => { void onToggleAutoApprove(); }}
            />
          ) : null}
          <NativeSelect
            disabled={availableAgents.length === 0}
            options={availableAgents.map((agent) => ({ value: agent.id, label: agent.label }))}
            selectedValue={chatPreferences.mode}
            onValueChange={(mode) => updateChatPreferences({ mode })}
            title={t('chat:composer.chooseAssistantMode')}
            renderTrigger={({ disabled, open }) => (
              <IconButton
                testID="chat-agent-button"
                accessibilityLabel={`${t('chat:composer.agent')}: ${selectedAgentLabel}`}
                icon={chatPreferences.mode === 'build' ? 'hammer-wrench' : chatPreferences.mode === 'plan' ? 'clipboard-text-outline' : 'robot-outline'}
                size={22}
                iconColor={palette.text}
                containerColor="transparent"
                style={styles.composerActionButton}
                disabled={disabled}
                onPress={() => { Keyboard.dismiss(); open(); }}
              />
            )}
          />
          <View style={styles.composerModelSummary}>
            {fontScale <= 1.3 ? modelPicker : null}
          </View>
          <IconButton
            testID="chat-secondary-button"
            accessibilityLabel={t(isSpeechInputListening ? 'chat:composer.stopDictation' : 'chat:composer.startDictation')}
            icon={isSpeechInputListening ? 'microphone-off' : 'microphone-outline'}
            size={24}
            iconColor={palette.muted}
            containerColor="transparent"
            style={styles.composerActionButton}
            disabled={conversation.active || connectionStatus !== 'connected' || (!isSpeechInputListening && !isSpeechInputAvailable)}
            onPress={onToggleRecording}
          />
          <IconButton
            testID="chat-primary-button"
            accessibilityLabel={t(primaryAction === 'voice' ? (conversation.active ? 'chat:header.stopConversationMode' : 'chat:header.startConversationMode') : primaryAction === 'send' ? (shellMode ? 'chat:composer.runShell' : 'chat:composer.sendTask') : 'chat:composer.stopTask')}
            mode="contained"
            icon={primaryAction === 'voice' ? 'waveform' : primaryAction === 'send' ? (shellMode ? 'console-line' : 'arrow-up') : 'stop'}
            size={22}
            style={styles.composerPrimaryButton}
            containerColor={palette.text}
            iconColor={palette.surfaceAlt}
            loading={primaryAction === 'stop' && isStoppingSession}
            disabled={primaryDisabled}
            onPress={primaryAction === 'voice' ? onToggleConversationMode : onSend}
          />
        </View>
      </View>
    </Surface>
  );
}
