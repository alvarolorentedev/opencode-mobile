import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';
import { Icon } from '@/shared/ui/icon';
import { Spinner } from '@/shared/ui/spinner';
import { TextField } from '@/shared/ui/text-field';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text as NativeText, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttachmentStrip } from './attachment-strip';
import { ProjectPicker } from '@/features/projects/index';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';

import { Fonts } from '@/shared/ui/theme/theme';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { getConnectionScope } from '@/shared/contracts/connection-scope';
import { useSharedInput , useBootState as useOnboarding } from '@/runtime/workspace';
import { useConnection } from '@/features/connections/context';
import { useProjects } from '@/features/projects/context';

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
  const sharedInput = useSharedInput();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [chatPickerVisible, setChatPickerVisible] = useState(false);
  const [search, setSearch] = useState('');
  const pending = sharedInput.pending;
  const target = sharedInput.target;
  const connectionScope = getConnectionScope(settings);
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

  const expired = sharedInput.emptyReason === 'expired';
  const done = (
    <View className={cn(stylesClasses.center, "bg-background")}>
      <View className={cn(stylesClasses.panel, "bg-surface")}><Text className={cn("text-foreground")} variant="title">{expired ? t('share:expired') : t('share:empty')}</Text>{expired ? <Text className={cn(stylesClasses.centerCopy, "text-muted-foreground")} variant="description">{t('share:expiredDescription')}</Text> : null}<Button onPress={discard} variant="default" className={cn(stylesClasses.panelAction)} ><Text>{t('share:backToChat')}</Text></Button></View>
    </View>
  );

  return (
    <View className={cn(stylesClasses.screen, "bg-background")}>
      <ScreenHeader className={cn("bg-surface")} safeArea={insets.top !== 0}><HeaderTitle title={t('share:title')} textStyle={{ fontFamily: Fonts.display, fontWeight: '700' }} maxFontSizeMultiplier={1.5}></HeaderTitle><Button accessibilityLabel={t('common:actions.close')} onPress={() => router.dismissTo('/(tabs)')} variant="ghost" size="icon"><Icon name={"close"} size={24} /></Button></ScreenHeader>

      {!isHydrated || sharedInput.resolving ? (
        <View className={cn(stylesClasses.center)}><Spinner size="large" color={palette.tint} /></View>
      ) : !onboardingCompleted ? (
        <View className={cn(stylesClasses.center)}>
          <Text className={cn(stylesClasses.centerCopy, "text-muted-foreground")} variant="body">{t('share:finishSetup')}</Text>
          <Button onPress={() => router.replace('/onboarding')} variant="default"><Text>{t('share:continueSetup')}</Text></Button>
        </View>
      ) : !pending ? (
        <View className={cn("flex-1")}>{sharedInput.error ? <Text className={cn("text-destructive p-5")}>{sharedInput.error}</Text> : null}{done}</View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text className={cn("text-muted-foreground")} variant="description">{t('share:subtitle')}</Text>

          {!activeProject?.path ? <><Text className={cn("text-foreground")} variant="description">{t('share:project')}</Text>
          <View className={cn(stylesClasses.projectRow)}>
            <NativeText numberOfLines={1} className={cn(stylesClasses.projectName, "text-foreground")}>
              {activeProject?.label || t('share:noProject')}
            </NativeText>
            <Button onPress={() => setPickerVisible(true)} variant="outline"><Icon name={"folder-swap-outline"} size={20} /><Text>{t('share:chooseProject')}</Text></Button>
          </View></> : null}
          <NativeText numberOfLines={1} className={cn("text-muted-foreground")}>{settings.serverUrl}</NativeText>
          <Text  variant="description">{t('share:conversation')}</Text>
          <View className={cn(stylesClasses.projectRow)}>
            <NativeText numberOfLines={1} className={cn(stylesClasses.projectName, "text-foreground")}>{targetTitle}</NativeText>
            <Button disabled={sharedInput.busy} onPress={() => setChatPickerVisible(true)} variant="outline"><Text>{t('share:change')}</Text></Button>
          </View>
          {target?.projectPath ? <Text  variant="label">{target.projectPath}</Text> : null}
          {connection.status !== 'connected' ? (
            <Text className={cn("text-warning")} variant="label">{t('share:notConnected')}</Text>
          ) : null}

          {pending.text ? (
            <View className={cn(stylesClasses.block, "bg-surface border-border")}><Text selectable className={cn("text-foreground")}>{pending.text}</Text></View>
          ) : null}

          {pending.url ? (
            <View className={cn(stylesClasses.block, "bg-surface border-border")}><Text className={cn("text-muted-foreground")} variant="label">{t('share:link')}</Text><Text selectable className={cn("text-primary")}>{pending.url}</Text></View>
          ) : null}

          {pending.attachments.length > 0 ? (
            <View className={cn(stylesClasses.attachments)}>
              <Text className={cn("text-foreground")} variant="description">{t('share:attachments')}</Text>
              <AttachmentStrip attachments={pending.attachments} />
            </View>
          ) : null}

          {pending.skipped.length > 0 ? (
            <Text className={cn("text-warning")} variant="label">{t('share:skipped', { items: pending.skipped.join(', ') })}</Text>
          ) : null}
          {sharedInput.error ? <Text className={cn("text-destructive")}>{sharedInput.error}</Text> : null}

          <View className={cn(stylesClasses.footer)}>
            <Button onPress={discard} variant="outline"><Text>{t('share:discard')}</Text></Button>
            <Button disabled={sharedInput.busy || !target || (!pending.text && !pending.url && !pending.attachments.length)} onPress={() => void addToChat()} variant="default">{sharedInput.busy ? <Spinner size="small" /> : null}<Icon name={"plus"} size={20} /><Text>{t('share:addToChat')}</Text></Button>
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
        <TextField value={search} onChangeText={setSearch} placeholder={t('chat:library.searchPlaceholder')}></TextField>
        {activeProject?.path ? <Button onPress={() => {
          sharedInput.selectTarget({ connectionScope, projectPath: activeProject.path });
          setChatPickerVisible(false);
        }} variant="ghost"><Icon name={"plus"} size={20} /><Text>{t('chat:library.newChat')}</Text></Button> : null}
        {sharedInput.targetsLoading && sharedInput.targets.length === 0 ? <Spinner color={palette.tint} /> : null}
        {sharedInput.targetsError ? (
          <View className={cn(stylesClasses.targetState)}>
            <Text accessibilityRole="alert" className={cn("text-destructive")}>{sharedInput.targetsError}</Text>
            <Button onPress={() => void sharedInput.refreshTargets()} variant="ghost"><Text>{t('common:actions.retry')}</Text></Button>
          </View>
        ) : null}
        {!sharedInput.targetsLoading && !sharedInput.targetsError && sharedInput.targets.length === 0 ? (
          <Text className={cn("text-muted-foreground")}>{t('share:noConversations')}</Text>
        ) : null}
        {sharedInput.targets.filter((item) => `${item.title || ''} ${item.projectPath}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((item) => {
          const isSelected = Boolean(target && item.connectionScope === target.connectionScope
            && item.projectPath === target.projectPath && item.sessionId === target.sessionId);
          const label = `${item.title || t('chat:library.untitledChat')} · ${item.projectPath.split('/').filter(Boolean).pop()}`;
          return (
            <Button key={JSON.stringify([item.connectionScope, item.projectPath, item.sessionId])} accessibilityLabel={isSelected ? `${label}, ${t('chat:modelPicker.selected')}` : label} onPress={() => {
                sharedInput.selectTarget(item); setChatPickerVisible(false);
              }} variant="ghost" className={cn("min-h-11")} ><Icon name={isSelected ? 'check' : undefined} size={20} /><Text>{label}</Text></Button>
          );
        })}
        {search.trim() && sharedInput.targets.length > 0 && !sharedInput.targets.some((item) => `${item.title || ''} ${item.projectPath}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ? (
          <Text className={cn("text-muted-foreground")}>{t('chat:library.noMatchingChats')}</Text>
        ) : null}
      </OverlaySheet>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 }
});

const stylesClasses = {
  "center": "flex-1 items-center justify-center p-6 gap-4",
  "panel": "w-full max-w-120 p-6 gap-3 rounded-[16px] items-center",
  "centerCopy": "text-center",
  "panelAction": "mt-2",
  "screen": "flex-1",
  "projectRow": "flex-row items-center gap-3 flex-wrap",
  "projectName": "flex-1 min-w-30 font-semibold",
  "block": "border rounded-[12px] p-3 gap-1",
  "attachments": "gap-2",
  "footer": "flex-row justify-end flex-wrap gap-2.5 mt-2",
  "targetState": "items-start gap-1.5"
} as const;
