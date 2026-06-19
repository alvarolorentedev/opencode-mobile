import React, { useCallback, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Menu, Surface, Text, TextInput } from 'react-native-paper';

import { type BellowsChatMessage } from '@/lib/bellows/client';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BellowsChatProvider, useBellowsChat } from '@/providers/bellows-chat-provider';

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message, palette }: { message: BellowsChatMessage; palette: typeof Colors.light }) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <Surface
        style={[
          styles.bubble,
          {
            backgroundColor: isUser ? palette.bubbleUser : palette.bubbleAssistant,
            alignSelf: isUser ? 'flex-end' : 'flex-start',
          },
        ]}
        elevation={1}
      >
        <Text
          style={[
            styles.bubbleText,
            { color: isUser ? palette.onBubbleUser : palette.onBubbleAssistant },
          ]}
        >
          {message.content}
        </Text>
      </Surface>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chat Content (uses the provider)
// ---------------------------------------------------------------------------

function BellowsChatContent() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { messages, loading, error, models, selectedModel, setSelectedModel, sendMessage } = useBellowsChat();

  const [inputText, setInputText] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || loading) return;
    setInputText('');
    await sendMessage(text);
  }, [inputText, loading, sendMessage]);

  const renderItem = useCallback(({ item }: { item: BellowsChatMessage }) => (
    <MessageBubble message={item} palette={palette} />
  ), [palette]);

  const keyExtractor = useCallback((_: BellowsChatMessage, index: number) => String(index), []);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: palette.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Model Selector */}
      <View style={[styles.toolbar, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchor={
            <Surface
              style={[styles.modelButton, { backgroundColor: palette.surfaceAlt }]}
              elevation={0}
            >
              <Text
                style={[styles.modelLabel, { color: palette.text }]}
                onPress={() => setMenuVisible(true)}
                numberOfLines={1}
              >
                {selectedModel}
              </Text>
              <IconButton
                icon="chevron-down"
                size={16}
                iconColor={palette.muted}
                onPress={() => setMenuVisible(true)}
                style={styles.chevronButton}
              />
            </Surface>
          }
        >
          {models.map((m) => (
            <Menu.Item
              key={m.id}
              title={m.id}
              onPress={() => {
                setSelectedModel(m.id);
                setMenuVisible(false);
              }}
            />
          ))}
          {models.length === 0 && (
            <Menu.Item title="No models loaded" disabled />
          )}
        </Menu>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: palette.muted }]}>
              Start a conversation with Bellows
            </Text>
          </View>
        }
      />

      {/* Error display */}
      {error && (
        <View style={[styles.errorBar, { backgroundColor: palette.danger }]}>
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
        </View>
      )}

      {/* Loading indicator */}
      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={palette.tint} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Thinking...</Text>
        </View>
      )}

      {/* Input */}
      <View style={[styles.inputRow, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
        <TextInput
          style={[styles.input, { backgroundColor: palette.surfaceAlt }]}
          textColor={palette.text}
          placeholderTextColor={palette.muted}
          placeholder="Message..."
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline
          mode="outlined"
          outlineColor={palette.border}
          activeOutlineColor={palette.tint}
          dense
        />
        <IconButton
          icon="send"
          iconColor={palette.tint}
          size={24}
          onPress={handleSend}
          disabled={!inputText.trim() || loading}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Screen (wraps in provider)
// ---------------------------------------------------------------------------

export default function BellowsChatScreen() {
  return (
    <BellowsChatProvider>
      <BellowsChatContent />
    </BellowsChatProvider>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
  },
  modelLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  chevronButton: {
    margin: 0,
  },
  messageList: {
    padding: 12,
    paddingBottom: 8,
    flexGrow: 1,
  },
  bubbleRow: {
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  bubbleRowUser: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 15,
  },
  errorBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    color: '#fff',
    fontSize: 13,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    fontSize: 15,
  },
});
