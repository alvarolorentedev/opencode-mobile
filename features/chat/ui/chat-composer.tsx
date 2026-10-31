import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Badge } from '@/shared/ui/badge';
import { Icon } from '@/shared/ui/icon';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { withAlpha } from '@/shared/ui/theme/color';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, useWindowDimensions, View } from 'react-native';

import { Colors } from '@/shared/ui/theme/theme';

import { CatalogSelect } from '@/shared/ui/catalog-select';
import { AttachmentStrip } from '@/features/sharing/index';
import { ComposerSuggestions } from '@/features/chat/ui/composer-suggestions';
import type { ComposerSuggestion, ComposerSuggestionGroup } from '@/features/chat/ui/composer-suggestion-types';
import { ModelPicker , getModelVariantLabel } from '@/features/ai/index';
import { styles, slimStylesClasses, stylesClasses } from '@/features/chat/ui/chat-view-styles';
import { getAutoApproveIcon } from '@/features/chat/ui/chat-view-utils';
import type { AgentOption, ModelOption } from '@/shared/contracts/model-options';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { Command } from '@/shared/protocol/opencode/types';

type Palette = typeof Colors.light;

type Attachment = { uri: string; mime?: string; filename?: string };

type ChatComposerProps = {
  attachments: Attachment[];
  availableAgents: AgentOption[];
  chatPreferences: ChatPreferences;
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  conversation: { active: boolean; confirmation?: import('@/features/voice/index').ConversationConfirmationState; isListening: boolean; phase: string; readbackPhase: 'idle' | 'waiting' | 'speaking'; statusLabel?: string; wakePhrase: string; wakePhraseRequired: boolean };
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
  autoRoutingEnabled: boolean;
  autoRoutingAvailable: boolean;
  onAutoRoutingChange: (enabled: boolean) => void;
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
  autoRoutingEnabled,
  autoRoutingAvailable,
  onAutoRoutingChange,
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
  const inputRef = useRef<ComponentRef<typeof Input>>(null);
  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);
  // Keep the established composer floor while iOS sizes the multiline input.
  const minInputHeight = slim ? 40 : 44;
  const maxInputHeight = slim ? 90 : 110;
  const hasComposerContent = Boolean(draft.trim()) || attachments.length > 0;
  const primaryAction = !showSendAction ? 'stop' : hasComposerContent ? 'send' : 'voice';
  const primaryDisabled = primaryAction === 'stop'
    ? !currentSessionId || isStoppingSession
    : primaryAction === 'send'
      ? connectionStatus !== 'connected' || isSpeechInputListening
      : connectionStatus !== 'connected' || !isSpeechInputAvailable;
  const autoRoutingActive = autoRoutingEnabled && autoRoutingAvailable;
  const selectedModel = visibleModels.find((model) => model.id === chatPreferences.modelId);
  const reasoningLabel = !autoRoutingActive && selectedModel?.variants.length ? getModelVariantLabel(selectedVariant, t) : undefined;

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
      onSelect={(model) => updateChatPreferences({
        providerId: model.providerID,
        modelId: model.id,
        ...(chatPreferences.autoModel.enabled
          ? { autoModel: { ...chatPreferences.autoModel, enabled: false } }
          : {}),
      })}
      recentModelIds={chatPreferences.recentModelIds}
      selectedModelId={chatPreferences.modelId}
      slim={slim}
      autoRoutingEnabled={autoRoutingActive}
      autoRoutingAvailable={autoRoutingAvailable}
      onAutoRoutingChange={autoRoutingAvailable ? onAutoRoutingChange : undefined}
    />
  );

  return (
    <View className={cn(stylesClasses.composer, slim && slimStylesClasses.composer, "bg-background border-t-[0px]")}>{conversation.active ? (
        <View className={cn(stylesClasses.conversationBanner)} style={[{ backgroundColor: withAlpha(palette.tint, 0x10 / 255), borderColor: withAlpha(palette.tint, 0x28 / 255) }]}>
          <View className={cn(stylesClasses.conversationBannerHeader)}>
            <Text className={cn("text-foreground")} variant="description">{t('chat:composer.conversationMode')}</Text>
            <Badge  variant="secondary"><Icon name={conversation.phase === 'speaking' ? 'volume-high' : 'microphone'} size={18} /><Text>{conversation.phase === 'confirming' ? t('chat:composer.confirming') : conversation.statusLabel || t('common:labels.active')}</Text></Badge>
          </View>
          <Text className={cn("text-muted-foreground")} variant="label">{conversation.readbackPhase === 'speaking'
              ? t('chat:composer.readingReply')
              : conversation.confirmation?.active
                ? t('chat:composer.confirmHint')
                : conversation.wakePhraseRequired
                  ? t('chat:composer.conversationHint', { phrase: conversation.wakePhrase })
                  : t('chat:composer.noWakeHint')}</Text>
        </View>
      ) : null}{attachments.length > 0 ? <AttachmentStrip attachments={attachments} onRemove={onRemoveAttachment} /> : null}{isV2 && suggestionsActive ? (
        <ComposerSuggestions
          error={suggestionsError}
          groups={suggestions}
          searching={suggestionsSearching}
          onSelect={onSuggestionSelect}
        />
      ) : null}{!isV2 && draft.startsWith('/') && !draft.includes(' ') && commands.length > 0 ? (
        <View className={cn(stylesClasses.attachmentRow)}>
          {commands.filter((command) => command.name.startsWith(draft.slice(1))).slice(0, 6).map((command) => (
            <Button key={command.name} onPress={() => {
                onDraftChange(`/${command.name} `);
              }} variant="secondary" size="sm"><Text>/{command.name}</Text></Button>
          ))}
        </View>
      ) : null}{isV2 && shellMode ? (
        <View testID="chat-shell-banner" className={cn(stylesClasses.shellBanner)} style={[{ backgroundColor: withAlpha(palette.tint, 0x10 / 255), borderColor: withAlpha(palette.tint, 0x28 / 255) }]}>
          <Text className={cn("text-foreground")} variant="description">{t('chat:composer.shellCommand')}</Text>
          <Text className={cn("text-muted-foreground")} variant="label">{t('chat:composer.shellHint')}</Text>
        </View>
      ) : null}{isSpeechInputListening || conversation.isListening ? (
        <View className={cn(stylesClasses.voiceStatusRow)}>
          <Badge className={cn(stylesClasses.voiceStatusChip)} style={[{ backgroundColor: withAlpha(palette.tint, 0x14 / 255) }]} variant="secondary"><Icon name={"microphone"} size={18} /><Text>{conversation.active ? t('chat:composer.conversationActive') : t('chat:composer.listening')}</Text></Badge>
        </View>
      ) : null}<View testID="chat-composer-card" className={cn(stylesClasses.composerCard, slim && "rounded-[22px]", "bg-surface-alt")}>
        <Input ref={inputRef} testID="chat-prompt-input" value={draft} onChangeText={onDraftChange} onSelectionChange={({ nativeEvent }) => onSelectionChange(nativeEvent.selection)} onContentSizeChange={Platform.OS === 'ios' ? undefined : ({ nativeEvent }) => updateInputHeight(nativeEvent.contentSize.height)} editable={!isSpeechInputListening} multiline scrollEnabled={Platform.OS === 'ios' ? true : displayedInputHeight >= maxInputHeight} placeholder={t('chat:composer.placeholder')} placeholderTextColor={palette.muted} textAlignVertical="top" style={[[
            inputTextStyle,
            Platform.OS === 'ios'
              // Let the platform size the multiline input and scroll at the cap.
              ? { minHeight: minInputHeight, maxHeight: maxInputHeight, color: palette.text }
              : { height: displayedInputHeight, color: palette.text },
          ], Platform.OS === 'ios' ? [styles.inputContentCompact, { minHeight: minInputHeight, maxHeight: maxInputHeight }] : styles.inputContentCompact]} className="border-0 bg-transparent min-h-0 px-0 py-0"></Input>
        {fontScale > 1.3 ? <View>{modelPicker}</View> : null}
        <View className={cn(stylesClasses.composerToolbar)}>
          <Button testID="chat-attach-button" accessibilityLabel={t('chat:composer.attachFiles')} onPress={onAttach} variant="ghost" size="icon" className={cn(stylesClasses.composerActionButton, "bg-transparent")} ><Icon name={"plus"} size={24} color={palette.text} /></Button>
          {autoApproveAvailable ? (
            <Button testID="chat-approve-button" accessibilityLabel={`${t('chat:composer.approvals')}: ${chatPreferences.autoApprove ? t('chat:composer.autoApproveEnabled') : t('chat:composer.askPermission')}`} accessibilityState={{ checked: chatPreferences.autoApprove }} disabled={isUpdatingAutoApprove} onPress={() => { void onToggleAutoApprove(); }} variant="ghost" size="icon" className={cn(stylesClasses.composerActionButton, "bg-transparent")} >{isUpdatingAutoApprove ? <Spinner size="small" /> : null}<Icon name={getAutoApproveIcon(chatPreferences.autoApprove)} size={22} color={chatPreferences.autoApprove ? palette.warning : palette.text} /></Button>
          ) : null}
          <CatalogSelect
            disabled={availableAgents.length === 0}
            options={availableAgents.map((agent) => ({ value: agent.id, label: agent.label }))}
            selectedValue={chatPreferences.mode}
            onValueChange={(mode) => updateChatPreferences({ mode })}
            title={t('chat:composer.chooseAssistantMode')}
            renderTrigger={({ disabled, open }) => (
              <Button testID="chat-agent-button" accessibilityLabel={`${t('chat:composer.agent')}: ${selectedAgentLabel}`} disabled={disabled} onPress={() => { Keyboard.dismiss(); open(); }} variant="ghost" size="icon" className={cn(stylesClasses.composerActionButton, "bg-transparent")} ><Icon name={chatPreferences.mode === 'build' ? 'hammer-wrench' : chatPreferences.mode === 'plan' ? 'clipboard-text-outline' : 'robot-outline'} size={22} color={palette.text} /></Button>
            )}
          />
          <View className={cn(stylesClasses.composerModelSummary)}>
            {fontScale <= 1.3 ? modelPicker : null}
          </View>
          <Button testID="chat-secondary-button" accessibilityLabel={t(isSpeechInputListening ? 'chat:composer.stopDictation' : 'chat:composer.startDictation')} disabled={conversation.active || connectionStatus !== 'connected' || (!isSpeechInputListening && !isSpeechInputAvailable)} onPress={onToggleRecording} variant="ghost" size="icon" className={cn(stylesClasses.composerActionButton, "bg-transparent")} ><Icon name={isSpeechInputListening ? 'microphone-off' : 'microphone-outline'} size={24} color={palette.muted} /></Button>
          <Button testID="chat-primary-button" accessibilityLabel={t(primaryAction === 'voice' ? (conversation.active ? 'chat:header.stopConversationMode' : 'chat:header.startConversationMode') : primaryAction === 'send' ? (shellMode ? 'chat:composer.runShell' : 'chat:composer.sendTask') : 'chat:composer.stopTask')} disabled={primaryDisabled} onPress={primaryAction === 'voice' ? onToggleConversationMode : onSend} variant="default" size="icon" className={cn(stylesClasses.composerPrimaryButton, "bg-foreground")} >{primaryAction === 'stop' && isStoppingSession ? <Spinner size="small" /> : null}<Icon name={primaryAction === 'voice' ? 'waveform' : primaryAction === 'send' ? (shellMode ? 'console-line' : 'arrow-up') : 'stop'} size={22} color={palette.surfaceAlt} /></Button>
        </View>
      </View></View>
  );
}
