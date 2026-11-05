import { Input } from '@/shared/ui/input';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import { Platform, type StyleProp, type TextStyle } from 'react-native';

import { findComposerAccentRanges } from '@/features/chat/model/composer-accent';
import type { MarkdownTextInputProps } from '@expensify/react-native-live-markdown';

type MarkdownTextInputComponent = ForwardRefExoticComponent<
  MarkdownTextInputProps & RefAttributes<{ focus: () => void }>
>;

// The package entry also exports its default ExpensiMark parser, which requires
// expensify-common and a workletized html-entities. Only the input is needed.
// Import the source entry: the compiled lib entry loses the native component
// spec that Metro's codegen transform needs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MarkdownTextInput = (Platform.OS === 'web' ? undefined : require('@expensify/react-native-live-markdown/src/MarkdownTextInput').default) as MarkdownTextInputComponent | undefined;

const INPUT_CLASS_NAME = 'w-auto self-stretch border-0 shadow-none bg-transparent dark:bg-transparent min-h-0 px-0 py-0';

type ChatPromptInputProps = {
  editable: boolean;
  focusRequest: number;
  onChangeText: (value: string) => void;
  onContentSizeChange?: (height: number) => void;
  onSelectionChange: (selection: { start: number; end: number }) => void;
  placeholder: string;
  placeholderTextColor: string;
  scrollEnabled: boolean;
  style: StyleProp<TextStyle>;
  tint: string;
  value: string;
};

/**
 * Native keeps the live markdown input so `@` and leading `/` tokens are bold in
 * the accent color. Web keeps the plain input; it has no live highlight.
 */
export function ChatPromptInput({
  editable,
  focusRequest,
  onChangeText,
  onContentSizeChange,
  onSelectionChange,
  placeholder,
  placeholderTextColor,
  scrollEnabled,
  style,
  tint,
  value,
}: ChatPromptInputProps) {
  const inputRef = useRef<{ focus: () => void } | null>(null);
  const setInputRef = useCallback((instance: { focus: () => void } | null) => {
    inputRef.current = instance;
  }, []);
  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  const markdownStyle = useMemo(() => ({
    mentionUser: { color: tint, backgroundColor: 'transparent', borderRadius: 0 },
    mentionHere: { color: tint, backgroundColor: 'transparent', borderRadius: 0 },
  }), [tint]);

  if (Platform.OS === 'web' || !MarkdownTextInput) {
    return (
      <Input
        ref={setInputRef}
        testID="chat-prompt-input"
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={({ nativeEvent }) => onSelectionChange(nativeEvent.selection)}
        onContentSizeChange={onContentSizeChange ? ({ nativeEvent }) => onContentSizeChange(nativeEvent.contentSize.height) : undefined}
        editable={editable}
        multiline
        scrollEnabled={scrollEnabled}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        textAlignVertical="top"
        style={style}
        className={INPUT_CLASS_NAME}
      />
    );
  }

  return (
    <MarkdownTextInput
      ref={setInputRef}
      testID="chat-prompt-input"
      value={value}
      onChangeText={onChangeText}
      onSelectionChange={({ nativeEvent }) => onSelectionChange(nativeEvent.selection)}
      onContentSizeChange={onContentSizeChange ? ({ nativeEvent }) => onContentSizeChange(nativeEvent.contentSize.height) : undefined}
      editable={editable}
      multiline
      scrollEnabled={scrollEnabled}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      selectionColor={tint}
      cursorColor={tint}
      textAlignVertical="top"
      style={style}
      parser={findComposerAccentRanges}
      markdownStyle={markdownStyle}
    />
  );
}
