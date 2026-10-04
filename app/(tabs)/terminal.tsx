import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  Card,
  IconButton,
  Snackbar,
  Surface,
  Text,
} from 'react-native-paper';

import { Fonts } from '@/constants/theme';
import { TextInput } from '@/components/ui/text-input';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { SwipeRow } from '@/components/ui/swipe-row';
import { useAppTheme } from '@/providers/theme-provider';
import type { Pty } from '@/lib/opencode/types';
import { useConnection, usePreferences, useTerminal, useWorkspace } from '@/providers/opencode-contexts';

export default function TerminalScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { palette } = useAppTheme();
  const outputRef = useRef<ScrollView>(null);
  const { activeProject } = useWorkspace();
  const { connect, connection } = useConnection();
  const { chatPreferences } = usePreferences();
  const slim = chatPreferences.slimInterface === true;
  const {
    activeTerminalId,
    closeTerminal,
    createTerminal,
    openTerminal,
    refreshTerminals,
    sendTerminalInput,
    terminalConnection,
    terminalOutput,
    terminals,
  } = useTerminal();
  const [line, setLine] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [isCreating, setIsCreating] = useState(false);
  const [terminalPickerVisible, setTerminalPickerVisible] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (connection.status === 'connected' && activeProject) {
      void refreshTerminals().catch((reason) => setError(message(reason, t('terminal:errors.load'))));
    }
  }, [activeProject, connection.status, refreshTerminals, t]);

  useEffect(() => {
    outputRef.current?.scrollToEnd({ animated: false });
  }, [terminalOutput]);

  async function handleCreate() {
    setIsCreating(true);
    try {
      await createTerminal();
    } catch (reason) {
      setError(message(reason, t('terminal:errors.create')));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleOpen(id: string) {
    setBusyId(id);
    try {
      await openTerminal(id);
    } catch (reason) {
      setError(message(reason, t('terminal:errors.open')));
    } finally {
      setBusyId(undefined);
    }
  }

  async function handleTerminate(id: string) {
    setBusyId(id);
    try {
      await closeTerminal(id);
    } catch (reason) {
      setError(message(reason, t('terminal:errors.terminate')));
    } finally {
      setBusyId(undefined);
    }
  }

  function confirmTerminate(terminal: Pty) {
    const run = () => void handleTerminate(terminal.id);
    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('terminal:console.terminateMessage', { title: terminal.title || terminal.command }))) run();
      return;
    }
    Alert.alert(t('terminal:console.terminateTitle'), terminal.title || terminal.command, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('terminal:console.terminateAction'), style: 'destructive', onPress: run },
    ]);
  }

  function handleSend() {
    if (!line) return;
    try {
      sendTerminalInput(`${line}\n`);
      setLine('');
    } catch (reason) {
      setError(message(reason, t('terminal:errors.send')));
    }
  }

  if (connection.status !== 'connected' || !activeProject) {
    return (
      <View style={[styles.emptyScreen, { backgroundColor: palette.background }]}>
        <Surface style={[styles.emptyPanel, { backgroundColor: palette.surface }]} elevation={1}>
          <Text variant="headlineSmall" style={{ color: palette.text }}>
            {connection.status !== 'connected' ? t('terminal:screen.connectTitle') : t('terminal:screen.chooseWorkspace')}
          </Text>
          <Text variant="bodyMedium" style={{ color: palette.muted }}>
            {connection.status !== 'connected'
              ? connection.message
              : t('terminal:screen.selectProject')}
          </Text>
          <Button
            mode="contained"
            loading={connection.status === 'connecting'}
            onPress={() => {
              const action = connection.status !== 'connected' ? connect() : Promise.resolve(router.push('/(tabs)/workspace'));
              void action.catch((reason) => setError(message(reason, t('terminal:errors.connect'))));
            }}>
            {connection.status !== 'connected' ? t('common:actions.reconnect') : t('terminal:screen.openWorkspaces')}
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
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
        <Appbar.Header
          style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: (slim ? 52 : 64) + insets.top }]}
          statusBarHeight={0}
          elevated>
          <View style={styles.headerMain}>
            <Pressable
              testID="terminal-selector"
              accessibilityRole="button"
              accessibilityLabel={t('terminal:console.selectTerminal')}
              onPress={() => setTerminalPickerVisible(true)}
              style={({ pressed }) => [styles.headerSelector, pressed && styles.headerSelectorPressed]}>
              <View style={styles.headerCopy}>
                <Text numberOfLines={1} variant="titleMedium" style={[styles.headerTitle, { color: palette.text }]}>
                  {activeTerminal?.title || activeTerminal?.command || t('terminal:console.selectTerminal')}
                </Text>
                <Text numberOfLines={1} variant="bodySmall" style={{ color: palette.muted }}>
                  {activeProject.path}  |  {terminalConnection}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
            </Pressable>
          </View>
          <View style={styles.headerActions}>
            <Appbar.Action
              testID="terminal-create-button"
              icon="plus"
              accessibilityLabel={t('terminal:console.create')}
              disabled={isCreating || Boolean(busyId)}
              onPress={() => void handleCreate()}
            />
            <Appbar.Action
              icon="refresh"
              accessibilityLabel={t('terminal:console.refresh')}
              disabled={Boolean(busyId) || isCreating}
              onPress={() => void refreshTerminals().catch((reason) => setError(message(reason, t('terminal:errors.refresh'))))}
            />
          </View>
        </Appbar.Header>

        <ScrollView ref={outputRef} style={styles.output} contentContainerStyle={[styles.outputContent, slim && { padding: 10 }]} keyboardDismissMode="on-drag" nestedScrollEnabled>
          {activeTerminalId ? <Text testID="terminal-output" selectable style={[styles.outputText, { color: palette.text }]}>{terminalOutput || t('terminal:console.connectedWaiting')}</Text> : (
            <Card mode="contained" style={{ backgroundColor: palette.surface, borderRadius: 16 }}>
              <Card.Title title={t('terminal:screen.title')} subtitle={activeProject.label} />
              <Card.Content style={{ gap: 12 }}>
                <Text style={{ color: palette.muted }}>{t('terminal:console.openOrCreate')}</Text>
                <Button mode="contained" icon="plus" loading={isCreating} disabled={isCreating || Boolean(busyId)} onPress={() => void handleCreate()}>
                  {t('terminal:console.new')}
                </Button>
                <Text variant="bodySmall" style={{ color: palette.muted }}>{t('terminal:console.lineHint')}</Text>
              </Card.Content>
            </Card>
          )}
        </ScrollView>

        <Surface style={[styles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, slim ? 8 : 12) }]} elevation={4}>
          <View style={[styles.composerRow, slim && { gap: 6 }]}>
            <View style={[styles.inputShell, slim && { minHeight: 40, borderRadius: 16 }, { backgroundColor: palette.background, borderColor: palette.border }]}> 
              <TextInput
                testID="terminal-line-input"
                mode="flat"
                dense
                placeholder={t('terminal:console.commandPlaceholder')}
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
              size={slim ? 18 : 20}
              style={[styles.sendButton, slim && { height: 36, width: 36 }]}
              containerColor={palette.tint}
              iconColor={palette.surface}
              accessibilityLabel={t('terminal:console.send')}
              disabled={!line || terminalConnection !== 'connected'}
              onPress={handleSend}
            />
          </View>
        </Surface>
      </KeyboardAvoidingView>
      <OverlaySheet visible={terminalPickerVisible} fitContent testID="terminal-picker" title={t('terminal:sessions.title')} onClose={() => setTerminalPickerVisible(false)}>
        {terminals.length === 0 ? <Text style={{ color: palette.muted }}>{t('terminal:sessions.empty')}</Text> : null}
        {terminals.map((terminal) => <SwipeRow key={terminal.id} title={`${terminal.title || terminal.command}, ${terminal.id.slice(0, 8)}`} actions={[{ label: t('common:actions.close'), icon: 'close', onPress: () => confirmTerminate(terminal) }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('terminal:sessions.openLabel', { terminal: `${terminal.title || terminal.command}, ${terminal.id.slice(0, 8)}` })} accessibilityHint={t('terminal:sessions.closeHint')} accessibilityState={{ selected: terminal.id === activeTerminalId }} onPress={() => { setTerminalPickerVisible(false); void handleOpen(terminal.id); }} style={[styles.terminalOption, { borderColor: terminal.id === activeTerminalId ? palette.tint : palette.border }]}>
            <MaterialCommunityIcons name={terminal.id === activeTerminalId ? 'check-circle' : 'console'} size={20} color={terminal.id === activeTerminalId ? palette.tint : palette.muted} />
            <View style={styles.terminalOptionText}><Text numberOfLines={1} variant="titleSmall">{terminal.title || terminal.command}</Text><Text numberOfLines={1} variant="bodySmall" style={{ color: palette.muted }}>{terminal.command} · {terminal.id.slice(0, 8)}</Text></View>
          </Pressable>
        </SwipeRow>)}
      </OverlaySheet>
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
  terminalOption: { minHeight: 64, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  terminalOptionText: { flex: 1, minWidth: 0 },
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
