import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Spinner } from '@/components/ui/spinner';
import { CardHeader, CardTitle, CardDescription, CardContent, Card } from '@/components/ui/card';
import { Feedback } from '@/components/ui/feedback';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


import { useConfirmation } from '@/components/ui/use-confirmation';
import { Fonts } from '@/constants/theme';
import { RetainedTerminals } from './retained-terminals';
import { NewTerminalSheet } from './new-terminal-sheet';
import { useWorkspaceTerminals } from '@/providers/use-workspace-terminals';
import { WorkspaceScope, useWorkspaces } from '@/providers/workspace-context';
import type { WorkspaceTarget } from '@/providers/workspace-types';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { SwipeRow } from '@/components/ui/swipe-row';
import { useUpdateBlocker } from '@/hooks/use-update-blocker';
import { usePalette } from '@/hooks/use-palette';
import { useConnection, usePreferences, useProjects, useTerminal } from '@/providers/opencode-contexts';

export default function TerminalScreen() {
  const registry = useWorkspaces();
  return <WorkspaceScope target={registry.terminalTarget ?? registry.focus}><TerminalContent /></WorkspaceScope>;
}

function TerminalContent() {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const visible = useIsFocused();
  const { activeProject } = useProjects();
  const registry = useWorkspaces();
  const { create, terminals: terminalEntries } = useWorkspaceTerminals();
  const multipleServers = registry.connections.length > 1;
  const [creating, setCreating] = useState(false);
  const { connection } = useConnection();
  const { chatPreferences } = usePreferences();
  const slim = chatPreferences.slimInterface === true;
  const {
    activeTerminalId,
    openTerminal,
    refreshTerminals,
    terminalConnection,
    terminalRuntime,
    terminals,
  } = useTerminal();
  const [busyId, setBusyId] = useState<string>();
  const [openingKey, setOpeningKey] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [terminalPickerVisible, setTerminalPickerVisible] = useState(false);
  const [error, setError] = useState<string>();
  useUpdateBlocker(isCreating || Boolean(busyId) || Boolean(openingKey));

  useEffect(() => {
    if (visible && connection.status === 'connected' && activeProject) {
      void refreshTerminals().catch((reason) => setError(message(reason, t('terminal:errors.load'))));
    }
  }, [activeProject, connection.status, refreshTerminals, t, visible]);

  async function handleCreate(target: WorkspaceTarget) {
    setIsCreating(true);
    try {
      await create(target);
    } catch (reason) {
      setError(message(reason, t('terminal:errors.create')));
      throw reason;
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

  const activeTerminal = terminals.find((terminal) => terminal.id === activeTerminalId);


  return <>{confirmation}{(
    <>
      <KeyboardAvoidingView
        className={cn(stylesClasses.screen, "bg-background")}
        behavior="padding">
        <ScreenHeader style={[styles.header, { backgroundColor: palette.surface, paddingTop: insets.top, height: (slim ? 52 : 64) + insets.top }]} safeArea={false}><View className={cn(stylesClasses.headerMain)}>
            <Pressable
              testID="terminal-selector"
              accessibilityRole="button"
              accessibilityLabel={t('terminal:console.selectTerminal')}
              onPress={() => {
                setTerminalPickerVisible(true);
                void refreshTerminals().catch((reason) => setError(message(reason, t('terminal:errors.refresh'))));
              }}
              style={({ pressed }) => [styles.headerSelector, pressed && styles.headerSelectorPressed]}>
              <View className={cn(stylesClasses.headerCopy)}>
                <Text numberOfLines={1} className={cn("text-foreground")} style={[styles.headerTitle]} variant="title">{activeTerminal?.title || activeTerminal?.command || t('terminal:console.selectTerminal')}</Text>
                <Text numberOfLines={1} className={cn("text-muted-foreground")} variant="label">{multipleServers ? `${registry.connections.find((entry) => entry.id === (registry.terminalTarget ?? registry.focus)?.connectionId)?.name} / ` : ''}{activeProject?.path ?? '—'}{' '}|  {t(`terminal:status.${terminalConnection}`)}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={20} color={palette.muted} />
            </Pressable>
          </View><View className={cn(stylesClasses.headerActions)}>
            <Button testID="terminal-create-button" accessibilityLabel={t('terminal:console.create')} disabled={isCreating || Boolean(busyId)} onPress={() => setCreating(true)} variant="ghost" size="icon"><Icon name={"plus"} size={24} /></Button>
          </View></ScreenHeader>

        <View className={cn(stylesClasses.output)}>
          <RetainedTerminals visible={visible} slim={slim} palette={palette} onCopied={() => setCopied(true)} onError={setError} />
        {connection.status !== 'connected' || !activeProject ? (
          <View className={cn(stylesClasses.emptyScreen)}>
            <View className={cn(stylesClasses.emptyPanel, "bg-surface")}><Text  variant="display">{connection.status !== 'connected' ? t('terminal:screen.connectTitle') : t('terminal:screen.chooseProject')}</Text><Text>{connection.status !== 'connected' ? connection.message : t('terminal:screen.selectProject')}</Text><Button onPress={() => {
                const target = registry.terminalTarget ?? registry.focus;
                const action = connection.status !== 'connected' && target ? registry.retry(target.connectionId) : Promise.resolve(router.push('/(tabs)/projects'));
                void action.catch((reason) => setError(message(reason, t('terminal:errors.connect'))));
              }} variant="default">{connection.status === 'connecting' ? <Spinner size="small" /> : null}<Text>{connection.status !== 'connected' ? t('common:actions.reconnect') : t('terminal:screen.openProjects')}</Text></Button></View>
          </View>
        ) : terminalRuntime.instances.length > 0 ? (
          <View pointerEvents="box-none" className={cn(stylesClasses.output)}>
            {terminalRuntime.instances.find((entry) => entry.id === activeTerminalId)?.error ? <View className={cn(stylesClasses.connectionError)}>
              <Text accessibilityRole="alert" className={cn("text-foreground")}>{terminalRuntime.instances.find((entry) => entry.id === activeTerminalId)?.error}</Text>
              <Button disabled={terminalConnection === 'exited'} onPress={() => { if (activeTerminalId) void handleOpen(activeTerminalId); }} variant="ghost"><Text>{t('common:actions.reconnect')}</Text></Button>
            </View> : null}
          </View>
        ) : (
          <ScrollView className={cn(stylesClasses.output)} contentContainerStyle={styles.outputContent}>
            <Card className={cn("bg-surface rounded-[16px]")}><CardHeader><CardTitle>{t('terminal:screen.title')}</CardTitle><CardDescription>{activeProject?.label}</CardDescription></CardHeader><CardContent className={cn("gap-3")}><Text className={cn("text-muted-foreground")}>{t('terminal:console.openOrCreate')}</Text><Button disabled={isCreating || Boolean(busyId)} onPress={() => setCreating(true)} variant="default">{isCreating ? <Spinner size="small" /> : null}<Icon name={"plus"} size={20} /><Text>{t('terminal:console.new')}</Text></Button><Text className={cn("text-muted-foreground")} variant="label">{t('terminal:console.interactiveHint')}</Text></CardContent></Card>
          </ScrollView>
        )}
        </View>
      </KeyboardAvoidingView>
      {creating ? <NewTerminalSheet target={registry.terminalTarget ?? (registry.focus && { ...registry.focus, projectPath: activeProject?.path ?? '' })} onClose={() => setCreating(false)} onCreate={handleCreate} /> : null}
      <OverlaySheet visible={terminalPickerVisible} fitContent testID="terminal-picker" title={t('terminal:sessions.title')} onClose={() => setTerminalPickerVisible(false)}>
        {terminalEntries.length === 0 ? <Text className={cn("text-muted-foreground")}>{t('terminal:sessions.empty')}</Text> : null}
        {terminalEntries.map(({ key, connectionId, projectPath, serverName, terminal, actions }) => {
          const title = `${terminal.title || terminal.command}, ${terminal.id.slice(0, 8)}${multipleServers ? `, ${serverName}, ${projectPath}` : ''}`;
          const entryKey = `${key}:${terminal.id}`;
          const inFlight = openingKey === entryKey;
          const active = terminal.id === activeTerminalId && connectionId === (registry.terminalTarget ?? registry.focus)?.connectionId
            && projectPath === activeProject?.path;
          const disabled = Boolean(openingKey) || Boolean(busyId);
          const open = async () => {
            setOpeningKey(entryKey);
            try {
              await registry.selectTerminalTarget({ connectionId, projectPath });
              await actions.openTerminal(terminal.id);
              setTerminalPickerVisible(false);
            } catch (reason) {
              setError(message(reason, t('terminal:errors.open')));
            } finally {
              setOpeningKey(undefined);
            }
          };
          return <SwipeRow key={entryKey} title={title} actions={[{ label: t('common:actions.close'), icon: 'close', onPress: () => {
            confirmAction(
              t('terminal:console.terminateTitle'),
              t('terminal:console.terminateMessage', {
                terminal: terminal.title || terminal.command,
                id: terminal.id.slice(0, 8),
                server: serverName,
                project: projectPath,
              }),
              t('terminal:console.terminateAction'),
              t('common:actions.cancel'),
              () => void actions.closeTerminal(terminal.id).catch((reason) => setError(String(reason))),
            );
          } }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: active, busy: inFlight, disabled }}
              accessibilityLabel={`${t('terminal:sessions.openLabel', { terminal: title })}${active ? `, ${t('common:labels.active')}` : ''}`}
              disabled={disabled} onPress={() => void open()} className={cn(stylesClasses.terminalOption)} style={[{ borderColor: active ? palette.tint : palette.border, opacity: disabled && !inFlight ? 0.6 : 1 }]}>
              {inFlight ? <Spinner size={20} color={palette.tint} /> : <MaterialCommunityIcons name={active ? 'check-circle' : 'console'} size={20} color={active ? palette.tint : palette.muted} />}
              <View className={cn(stylesClasses.terminalOptionText)}>
                <View className={cn(stylesClasses.terminalTitleLine)}>
                  <Text numberOfLines={1} className={cn(stylesClasses.terminalOptionText)}>{terminal.title || terminal.command}</Text>
                  {multipleServers ? <Text testID="terminal-server-chip" numberOfLines={1} className={cn(stylesClasses.serverChip, "text-muted-foreground border-border")}>{serverName}</Text> : null}
                </View>
                <Text numberOfLines={1} variant="label">{projectPath}</Text>
              </View>
            </Pressable>
          </SwipeRow>;
        })}
      </OverlaySheet>
      <Feedback duration={1600} open={copied} onOpenChange={() => (() => setCopied(false))()}>{t('terminal:console.copied')}</Feedback>
      <Feedback  open={Boolean(error)} onOpenChange={() => (() => setError(undefined))()}>{error}</Feedback>
    </>
  )}</>;
}

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

const styles = StyleSheet.create({
  header: { elevation: 0 },
  headerSelector: { alignItems: 'center', alignSelf: 'stretch', borderRadius: 14, flexDirection: 'row', gap: 8, justifyContent: 'center', marginRight: 8, minHeight: 48, paddingRight: 4 },
  headerSelectorPressed: { opacity: 0.82 },
  headerTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  outputContent: { flexGrow: 1, padding: 16 }
});

const stylesClasses = {
  "screen": "flex-1",
  "headerMain": "self-stretch flex-1 justify-center min-w-0",
  "headerCopy": "flex-1 min-w-0",
  "headerActions": "items-center flex-row shrink-0",
  "output": "flex-1",
  "emptyScreen": "items-center flex-1 justify-center p-6",
  "emptyPanel": "gap-3 max-w-140 p-6 rounded-[16px] w-full",
  "connectionError": "p-2 gap-1",
  "terminalOption": "min-h-16 border rounded-[14px] px-3.5 flex-row items-center gap-3",
  "terminalOptionText": "flex-1 min-w-0",
  "terminalTitleLine": "flex-row items-center gap-2",
  "serverChip": "max-w-30 text-[12px] border rounded-[12px] px-2 py-0.75"
} as const;
