import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  Button,
  IconButton,
  Menu,
  Snackbar,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Pty } from '@/lib/opencode/types';
import { useOpencode } from '@/providers/opencode-provider';

export default function TerminalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const outputRef = useRef<ScrollView>(null);
  const {
    activeProject,
    activeTerminalId,
    closeTerminal,
    connect,
    connection,
    createTerminal,
    openTerminal,
    refreshTerminals,
    sendTerminalInput,
    terminalConnection,
    terminalOutput,
    terminals,
  } = useOpencode();
  const [line, setLine] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [isCreating, setIsCreating] = useState(false);
  const [terminalMenuVisible, setTerminalMenuVisible] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (connection.status === 'connected' && activeProject) {
      void refreshTerminals().catch((reason) => setError(message(reason, 'Could not load terminals.')));
    }
  }, [activeProject, connection.status, refreshTerminals]);

  useEffect(() => {
    outputRef.current?.scrollToEnd({ animated: false });
  }, [terminalOutput]);

  async function handleCreate() {
    setIsCreating(true);
    try {
      await createTerminal();
    } catch (reason) {
      setError(message(reason, 'Could not create the terminal.'));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleOpen(id: string) {
    setBusyId(id);
    try {
      await openTerminal(id);
    } catch (reason) {
      setError(message(reason, 'Could not open the terminal.'));
    } finally {
      setBusyId(undefined);
    }
  }

  async function handleTerminate(id: string) {
    setBusyId(id);
    try {
      await closeTerminal(id);
    } catch (reason) {
      setError(message(reason, 'Could not terminate the terminal.'));
    } finally {
      setBusyId(undefined);
    }
  }

  function confirmTerminate(terminal: Pty) {
    const run = () => void handleTerminate(terminal.id);
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`Terminate ${terminal.title || terminal.command}?`)) run();
      return;
    }
    Alert.alert('Terminate terminal?', terminal.title || terminal.command, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Terminate', style: 'destructive', onPress: run },
    ]);
  }

  function handleSend() {
    if (!line) return;
    try {
      sendTerminalInput(`${line}\n`);
      setLine('');
    } catch (reason) {
      setError(message(reason, 'Could not send terminal input.'));
    }
  }

  if (connection.status !== 'connected' || !activeProject) {
    return (
      <View style={[styles.emptyScreen, { backgroundColor: palette.background }]}>
        <Surface style={[styles.emptyPanel, { backgroundColor: palette.surface }]} elevation={1}>
          <Text variant="headlineSmall" style={{ color: palette.text }}>
            {connection.status !== 'connected' ? 'Connect to OpenCode' : 'Choose a workspace'}
          </Text>
          <Text variant="bodyMedium" style={{ color: palette.muted }}>
            {connection.status !== 'connected'
              ? connection.message
              : 'Select a project before opening a terminal.'}
          </Text>
          <Button
            mode="contained"
            loading={connection.status === 'connecting'}
            onPress={() => {
              const action = connection.status !== 'connected' ? connect() : Promise.resolve(router.push('/(tabs)/workspace'));
              void action.catch((reason) => setError(message(reason, 'Could not connect.')));
            }}>
            {connection.status !== 'connected' ? 'Reconnect' : 'Open Workspaces'}
          </Button>
        </Surface>
        <Snackbar visible={Boolean(error)} onDismiss={() => setError(undefined)}>{error}</Snackbar>
      </View>
    );
  }

  const activeTerminal = terminals.find((terminal) => terminal.id === activeTerminalId);

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: palette.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
        <Appbar.Header
          style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: 64 + insets.top }]}
          statusBarHeight={0}
          elevated>
          <View style={styles.headerMain}>
            <Menu
              visible={terminalMenuVisible}
              onDismiss={() => setTerminalMenuVisible(false)}
              anchor={
                <Pressable
                  testID="terminal-selector"
                  onPress={() => setTerminalMenuVisible(true)}
                  style={({ pressed }) => [styles.headerSelector, pressed && styles.headerSelectorPressed]}>
                  <View style={styles.headerCopy}>
                    <Text numberOfLines={1} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}> 
                      {activeTerminal?.title || activeTerminal?.command || 'Select terminal'}
                    </Text>
                    <Text numberOfLines={1} variant="bodySmall" style={{ color: palette.muted }}>
                      {activeProject.path}  |  {terminalConnection}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
                </Pressable>
              }>
              {terminals.length === 0 ? <Menu.Item title="No terminals yet" disabled /> : null}
              {terminals.map((terminal) => (
                <Menu.Item
                  key={terminal.id}
                  title={terminal.title || terminal.command}
                  leadingIcon={terminal.id === activeTerminalId ? 'check' : undefined}
                  onPress={() => {
                    setTerminalMenuVisible(false);
                    void handleOpen(terminal.id);
                  }}
                />
              ))}
            </Menu>
          </View>
          <View style={styles.headerActions}>
            <Appbar.Action
              testID="terminal-create-button"
              icon="plus"
              accessibilityLabel="Create terminal"
              disabled={isCreating || Boolean(busyId)}
              onPress={() => void handleCreate()}
            />
            <Appbar.Action
              icon="refresh"
              accessibilityLabel="Refresh terminals"
              disabled={Boolean(busyId) || isCreating}
              onPress={() => void refreshTerminals().catch((reason) => setError(message(reason, 'Could not refresh terminals.')))}
            />
            {activeTerminal ? (
              <Appbar.Action
                testID="terminal-close-button"
                icon="close"
                color={palette.danger}
                accessibilityLabel="Close terminal"
                disabled={Boolean(busyId) || isCreating}
                onPress={() => confirmTerminate(activeTerminal)}
              />
            ) : null}
          </View>
        </Appbar.Header>

        <ScrollView ref={outputRef} style={styles.output} contentContainerStyle={styles.outputContent} nestedScrollEnabled>
          <Text testID="terminal-output" selectable style={[styles.outputText, { color: activeTerminalId ? palette.text : palette.muted }]}> 
            {activeTerminalId ? terminalOutput || 'Connected. Waiting for output...' : 'Open or create a terminal to begin.'}
          </Text>
        </ScrollView>

        <Surface style={[styles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, 12) }]} elevation={4}>
          <View style={styles.composerRow}>
            <View style={[styles.inputShell, { backgroundColor: palette.background, borderColor: palette.border }]}> 
              <TextInput
                testID="terminal-line-input"
                mode="flat"
                dense
                placeholder="Enter a command"
                value={line}
                onChangeText={setLine}
                onSubmitEditing={handleSend}
                disabled={terminalConnection !== 'connected'}
                style={[styles.lineInput, { color: palette.text }]}
                contentStyle={styles.lineInputContent}
                textColor={palette.text}
                placeholderTextColor={palette.muted}
                underlineColor="transparent"
                activeUnderlineColor="transparent"
              />
            </View>
            <IconButton
              testID="terminal-send-button"
              mode="contained"
              icon="send"
              size={20}
              style={styles.sendButton}
              containerColor={palette.tint}
              iconColor={palette.surface}
              accessibilityLabel="Send command"
              disabled={!line || terminalConnection !== 'connected'}
              onPress={handleSend}
            />
          </View>
        </Surface>
      </KeyboardAvoidingView>
      <Snackbar visible={Boolean(error)} onDismiss={() => setError(undefined)}>{error}</Snackbar>
    </>
  );
}

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  emptyScreen: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  emptyPanel: { gap: 12, maxWidth: 560, padding: 24, borderRadius: 16, width: '100%' },
  header: { elevation: 0 },
  headerMain: { alignSelf: 'stretch', flex: 1, justifyContent: 'center', minWidth: 0 },
  headerActions: { alignItems: 'center', flexDirection: 'row', flexShrink: 0 },
  headerSelector: { alignItems: 'center', alignSelf: 'stretch', borderRadius: 14, flexDirection: 'row', gap: 8, justifyContent: 'center', marginRight: 8, minHeight: 48, paddingRight: 4 },
  headerSelectorPressed: { opacity: 0.82 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  output: { flex: 1 },
  outputContent: { flexGrow: 1, padding: 16 },
  outputText: { fontFamily: Fonts.mono, fontSize: 14, lineHeight: 21 },
  composer: { borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 10 },
  composerRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  inputShell: { borderRadius: 22, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 12 },
  lineInput: { backgroundColor: 'transparent', flex: 1 },
  lineInputContent: { fontFamily: Fonts.mono, paddingHorizontal: 0, paddingVertical: 0 },
  sendButton: { alignSelf: 'center', borderRadius: 999, height: 44, margin: 0, width: 44 },
});
