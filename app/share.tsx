import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text as NativeText, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, Surface, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachmentStrip } from '@/components/chat/attachment-strip';
import { ProjectPicker } from '@/components/ui/project-picker';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { TextInput } from '@/components/ui/text-input';
import { Fonts } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';
import { useChat, useConnection, useOnboarding, useProjects } from '@/providers/opencode-contexts';

/**
 * Preview surface for content shared into the app from the OS share sheet.
 * Thin controller: the provider stages the payload, this screen only lets the
 * user review it, pick a project, and add it to the composer. Nothing is
 * submitted from here; the composer still owns the explicit send action.
 */
export default function ShareScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { receipt } = useLocalSearchParams<{ receipt?: string }>();
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const { isHydrated, onboardingCompleted } = useOnboarding();
  const { connection, settings } = useConnection();
  const { activeProject } = useProjects();
  const { sharedInput } = useChat();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [chatPickerVisible, setChatPickerVisible] = useState(false);
  const [search, setSearch] = useState('');
  const pending = sharedInput.pending;
  const target = sharedInput.target;
  const targetTitle = target?.sessionId
    ? sharedInput.targets.find((item) => item.sessionId === target.sessionId)?.title || t('chat:library.untitledChat')
    : t('chat:library.newChat');
  const refreshShared = sharedInput.refreshShared;
  useEffect(() => { void refreshShared(); }, [receipt, refreshShared]);

  const addToChat = async () => {
    if (await sharedInput.addToChat()) router.dismissTo('/(tabs)');
  };
  const discard = () => {
    sharedInput.clearShared();
    router.dismissTo('/(tabs)');
  };

  const done = (
    <View style={[styles.center, { backgroundColor: palette.background }]}>
      <Surface style={[styles.panel, { backgroundColor: palette.surface }]} elevation={1}>
        <Text variant="titleMedium" style={{ color: palette.text }}>{t('share:empty')}</Text>
        <Button mode="contained" onPress={discard} style={styles.panelAction}>{t('share:backToChat')}</Button>
      </Surface>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: palette.surface }} elevated>
        <Appbar.Content titleMaxFontSizeMultiplier={1.5} title={t('share:title')} titleStyle={{ fontFamily: Fonts.display, fontWeight: '700' }} />
        <Appbar.Action icon="close" accessibilityLabel={t('share:discard')} onPress={discard} />
      </Appbar.Header>

      {!isHydrated || sharedInput.resolving ? (
        <View style={styles.center}><ActivityIndicator size="large" color={palette.tint} /></View>
      ) : !onboardingCompleted ? (
        <View style={styles.center}>
          <Text variant="bodyLarge" style={[styles.centerCopy, { color: palette.muted }]}>{t('share:finishSetup')}</Text>
          <Button mode="contained" onPress={() => router.replace('/onboarding')}>{t('share:continueSetup')}</Button>
        </View>
      ) : !pending ? (
        <View style={{ flex: 1 }}>{sharedInput.error ? <Text style={{ color: palette.danger, padding: 20 }}>{sharedInput.error}</Text> : null}{done}</View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text variant="bodyMedium" style={{ color: palette.muted }}>{t('share:subtitle')}</Text>

          {!activeProject?.path ? <><Text variant="titleSmall" style={{ color: palette.text }}>{t('share:project')}</Text>
          <View style={styles.projectRow}>
            <NativeText numberOfLines={1} style={[styles.projectName, { color: palette.text }]}>
              {activeProject?.label || t('share:noProject')}
            </NativeText>
            <Button compact mode="outlined" icon="folder-swap-outline" onPress={() => setPickerVisible(true)}>
              {t('share:chooseProject')}
            </Button>
          </View></> : null}
          <NativeText numberOfLines={1} style={{ color: palette.muted }}>{settings.serverUrl}</NativeText>
          <Text variant="titleSmall">{t('share:conversation')}</Text>
          <View style={styles.projectRow}>
            <NativeText numberOfLines={1} style={[styles.projectName, { color: palette.text }]}>{targetTitle}</NativeText>
            <Button disabled={sharedInput.busy} mode="outlined" onPress={() => setChatPickerVisible(true)}>{t('share:change')}</Button>
          </View>
          {target?.projectPath ? <Text variant="bodySmall">{target.projectPath}</Text> : null}
          {connection.status !== 'connected' ? (
            <Text variant="bodySmall" style={{ color: palette.warning }}>{t('share:notConnected')}</Text>
          ) : null}

          {pending.text ? (
            <Surface style={[styles.block, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <Text selectable style={{ color: palette.text }}>{pending.text}</Text>
            </Surface>
          ) : null}

          {pending.url ? (
            <Surface style={[styles.block, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <Text variant="labelSmall" style={{ color: palette.muted }}>{t('share:link')}</Text>
              <Text selectable style={{ color: palette.tint }}>{pending.url}</Text>
            </Surface>
          ) : null}

          {pending.attachments.length > 0 ? (
            <View style={styles.attachments}>
              <Text variant="titleSmall" style={{ color: palette.text }}>{t('share:attachments')}</Text>
              <AttachmentStrip attachments={pending.attachments} />
            </View>
          ) : null}

          {pending.skipped.length > 0 ? (
            <Text variant="bodySmall" style={{ color: palette.warning }}>
              {t('share:skipped', { items: pending.skipped.join(', ') })}
            </Text>
          ) : null}
          {sharedInput.error ? <Text style={{ color: palette.danger }}>{sharedInput.error}</Text> : null}

          <View style={styles.footer}>
            <Button mode="outlined" onPress={discard}>{t('share:discard')}</Button>
            <Button mode="contained" icon="plus" loading={sharedInput.busy}
              disabled={sharedInput.busy || !target || (!pending.text && !pending.url && !pending.attachments.length)}
              onPress={() => void addToChat()}>{t('share:addToChat')}</Button>
          </View>
        </ScrollView>
      )}

      <ProjectPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        activePath={activeProject?.path}
        testID="share-project-picker"
      />
      <OverlaySheet visible={chatPickerVisible} title={t('share:chooseConversation')} onClose={() => setChatPickerVisible(false)} testID="share-chat-picker">
        <TextInput mode="outlined" value={search} onChangeText={setSearch} placeholder={t('chat:library.searchPlaceholder')} />
        {activeProject?.path && target ? <Button icon="plus" onPress={() => {
          sharedInput.selectTarget({ connectionScope: target.connectionScope, projectPath: activeProject.path });
          setChatPickerVisible(false);
        }}>{t('chat:library.newChat')}</Button> : null}
        {sharedInput.targets.filter((item) => `${item.title || ''} ${item.projectPath}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((item) => (
          <Button key={JSON.stringify([item.connectionScope, item.projectPath, item.sessionId])} style={{ minHeight: 44 }} onPress={() => {
            sharedInput.selectTarget(item); setChatPickerVisible(false);
          }}>{item.title || t('chat:library.untitledChat')} · {item.projectPath.split('/').filter(Boolean).pop()}</Button>
        ))}
      </OverlaySheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  centerCopy: { textAlign: 'center' },
  panel: { width: '100%', maxWidth: 480, padding: 24, gap: 12, borderRadius: 16, alignItems: 'center' },
  panelAction: { marginTop: 8 },
  content: { padding: 20, gap: 12 },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  projectName: { flex: 1, minWidth: 120, fontWeight: '600' },
  block: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  attachments: { gap: 8 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 8 },
});
