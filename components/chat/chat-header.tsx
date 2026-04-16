import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScrollView, View } from 'react-native';
import { Appbar, Button, Portal, Surface, Text, TouchableRipple, List } from 'react-native-paper';

import { Colors } from '@/constants/theme';
import { getSessionSubtitle } from '@/lib/opencode/format';
import type { Session } from '@/lib/opencode/types';

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
};

export function ChatHeader({
  connectionStatus,
  conversation,
  currentSessionId,
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
}: ChatHeaderProps) {
  return (
    <>
      <Appbar.Header
        style={[styles.header, { backgroundColor: palette.surface, paddingTop: insetsTop, height: 64 + insetsTop }]}
        statusBarHeight={0}
        elevated>
        <View style={styles.headerMain}>
          <TouchableRipple borderless onPress={onOpenSessionMenu} style={styles.headerSessionAnchor}>
            <View style={styles.headerSessionContent}>
              <View style={styles.headerSessionTextWrap}>
                <Text numberOfLines={1} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}>
                  {selectedSession?.title || 'Untitled chat'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
            </View>
          </TouchableRipple>
        </View>
        <View style={styles.headerActions}>
          <Appbar.Action icon="plus" onPress={onCreateSession} disabled={isCreatingSession || connectionStatus !== 'connected'} />
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
            <TouchableRipple borderless onPress={onCloseMenu} style={styles.sessionPickerBackdrop}>
              <View style={styles.sessionPickerBackdropFill} />
            </TouchableRipple>
            <Surface
              style={[
                styles.sessionPickerSheet,
                {
                  top: 64 + insetsTop,
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
              elevation={4}>
              <View style={[styles.sessionPickerHeader, { borderBottomColor: palette.border }]}>
                <Text variant="titleMedium" style={{ color: palette.text }}>Chats</Text>
                <Button compact onPress={onCloseMenu}>Close</Button>
              </View>
              <ScrollView contentContainerStyle={styles.sessionPickerList} keyboardShouldPersistTaps="handled">
                {sessions.length === 0 ? <Text variant="bodyMedium" style={{ color: palette.muted }}>No chats yet.</Text> : null}
                {sessions.map((session) => {
                  const isSelected = session.id === currentSessionId;

                  return (
                    <List.Item
                      key={session.id}
                      title={session.title || 'Untitled chat'}
                      description={getSessionSubtitle(session)}
                      titleStyle={{ color: palette.text, fontWeight: isSelected ? '700' : '500' }}
                      descriptionStyle={{ color: palette.muted }}
                      left={() => (
                        isSelected ? <List.Icon icon="check-circle" color={palette.tint} /> : <List.Icon icon="message-outline" color={palette.muted} />
                      )}
                      onPress={() => onOpenSession(session.id)}
                      style={[styles.sessionPickerItem, { backgroundColor: isSelected ? palette.background : 'transparent', borderColor: palette.border }]}
                    />
                  );
                })}
              </ScrollView>
            </Surface>
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
      </Portal>
    </>
  );
}
