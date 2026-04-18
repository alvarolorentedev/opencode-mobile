import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text as NativeText, View } from 'react-native';
import { Appbar, Portal, Text } from 'react-native-paper';

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
          <Pressable onPress={onOpenSessionMenu} style={({ pressed }) => [styles.headerSessionAnchor, pressed && styles.headerSessionAnchorPressed]}>
            <View style={styles.headerSessionContent}>
              <View style={styles.headerSessionTextWrap}>
                <Text numberOfLines={1} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}> 
                  {selectedSession?.title || 'Untitled chat'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
            </View>
          </Pressable>
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
      </Portal>
    </>
  );
}
