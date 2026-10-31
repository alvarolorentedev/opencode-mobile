import { cn } from '@/lib/utils';
import { useConfirmation } from '@/components/ui/use-confirmation';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SettingTarget } from './settings-panel';

import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';


import {
  ConnectionProfileDialog,
  type ConnectionProfileFormValues,
} from '@/components/settings/connection-profile-dialog';
import { ConnectionMethodChooser } from '@/components/settings/connection-method-chooser';
import { ConnectionScanFlow } from '@/components/settings/connection-scan-flow';
import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { Colors } from '@/constants/theme';
import { findMatchingProfile, type ConnectionProfile } from '@/lib/connection-profiles';
import { hasWorkspaceDrafts } from '@/providers/workspace-presentation';
import { useWorkspacePresentation, useWorkspaces } from '@/providers/workspace-context';
import { getConnectionUiScope } from '@/lib/connection-scope';
import { getErrorMessage } from '@/lib/error-message';
import { useConnection } from '@/providers/opencode-contexts';

type Palette = typeof Colors.light;

const CURRENT_CONNECTION_KEY = 'current';

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit-profile'; profile: ConnectionProfile; password: string; headers: Record<string, string> }
  | { mode: 'edit-current' };

function connectionHost(serverUrl: string) {
  try {
    return new URL(serverUrl).host || serverUrl;
  } catch {
    return serverUrl;
  }
}

export function ConnectionProfiles({ palette, onManageConnect, onPair }: { palette: Palette; onManageConnect?: () => void; onPair?: () => void }) {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();
  const registry = useWorkspaces();
  const presentation = useWorkspacePresentation();
  const { settings, connection, connect, updateSettings, connectSetup, connectionProfiles } = useConnection();
  const { profiles, refresh, connect: connectProfile, passwordForEditing, headersForEditing, save, remove } = connectionProfiles;
  const [error, setError] = useState<string>();
  const [expandedKey, setExpandedKey] = useState<string>();
  const [switchingProfileId, setSwitchingProfileId] = useState<string>();
  const addedProfileId = useRef<string | undefined>(undefined);
  const [choosing, setChoosing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dialog, setDialog] = useState<DialogState>();

  useFocusEffect(useCallback(() => {
    void refresh().catch((reason) => setError(getErrorMessage(reason)));
  }, [refresh]));

  const activeProfile = findMatchingProfile(profiles, settings);
  const isReconnecting = connection.status === 'connecting';
  function manageConnect(profile: ConnectionProfile) {
    connectSetup.selectControlPlane(profile.connect!.controlPlaneUrl);
    onManageConnect?.();
  }

  async function handleConnect(profile: ConnectionProfile) {
    if (switchingProfileId) {
      return;
    }
    setSwitchingProfileId(profile.id);
    try {
      await connectProfile(profile);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setSwitchingProfileId(undefined);
    }
  }

  async function handleEditProfile(profile: ConnectionProfile) {
    const [password, headers] = await Promise.all([passwordForEditing(profile.id), headersForEditing(profile.id)]);
    setDialog({ mode: 'edit-profile', profile, password, headers });
  }

  function handleDelete(profile: ConnectionProfile) {
    const message = [t('settings:connection.deleteMessage', { name: profile.name }),
      hasWorkspaceDrafts(presentation, getConnectionUiScope(profile)) ? t('common:servers.discardDrafts') : undefined].filter(Boolean).join('\n\n');
    const confirmRemoval = () => {
      void remove(profile.id).catch((reason) => setError(getErrorMessage(reason)));
    };

    confirmAction(t('settings:connection.deleteTitle'), message, t('common:actions.delete'), t('common:actions.cancel'), confirmRemoval);
  }

  async function addAndConnect(values: ConnectionProfileFormValues) {
    const profile = await save(values, addedProfileId.current);
    addedProfileId.current = profile.id;
    setSwitchingProfileId(profile.id);
    try {
      const result = await connectProfile(profile);
      if (result.status !== 'connected') throw new Error(result.message);
      setDialog(undefined);
      setScanning(false);
      addedProfileId.current = undefined;
      setExpandedKey(profile.id);
    } finally {
      setSwitchingProfileId(undefined);
    }
  }

  async function handleDialogSubmit(values: ConnectionProfileFormValues) {
    const currentDialog = dialog;
    if (!currentDialog) {
      return;
    }

    if (currentDialog.mode === 'add') {
      await addAndConnect(values);
      return;
    }

    if (currentDialog.mode === 'edit-profile') {
      await save(values, currentDialog.profile.id);
      setDialog(undefined);
      return;
    }

    // Editing the current, not-yet-saved connection only touches live settings.
    updateSettings({ serverUrl: values.serverUrl, username: values.username, password: values.password, headers: values.headers });
    setDialog(undefined);
  }

  function renderRow({
    rowKey,
    testIDKey,
    name,
    subtitle,
    isActive,
    isSwitching,
    status = connection.status,
    actions,
    body,
  }: {
    rowKey: string;
    testIDKey: string;
    name: string;
    subtitle: string;
    isActive: boolean;
    isSwitching?: boolean;
    status?: typeof connection.status;
    actions: React.ReactNode;
    body: React.ReactNode;
  }) {
    const expanded = expandedKey === rowKey;
    return (
      <View key={rowKey} className={cn(stylesClasses.row, "border-border bg-background")}>
        <Pressable
          testID={`connection-row-${testIDKey}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpandedKey(expanded ? undefined : rowKey)}
          className={cn(stylesClasses.rowHeader)}>
          <Icon color={palette.muted} name={expanded ? 'chevron-down' : 'chevron-right'}></Icon>
          <View className={cn(stylesClasses.rowCopy)}>
            <Text numberOfLines={1} className={cn("text-foreground")} variant="description">{name}</Text>
            <Text numberOfLines={1} className={cn("text-muted-foreground")} variant="label">{subtitle}</Text>
          </View>
          {isSwitching || isActive ? (
            <View className={cn(stylesClasses.status, "bg-surface-alt")}><Text  variant="description">{t(`common:servers.status.${isSwitching ? 'connecting' : status}`)}</Text></View>
          ) : null}
        </Pressable>
        {expanded ? (
          <View className={cn(stylesClasses.rowBody)}>
            {body}
            <View className={cn(stylesClasses.actions)}>{actions}</View>
          </View>
        ) : null}
      </View>
    );
  }

  const rows: React.ReactNode[] = [];

  // The active connection is always editable, even when it has not been saved
  // as a profile yet.
  if (!activeProfile) {
    rows.push(renderRow({
      rowKey: CURRENT_CONNECTION_KEY,
      testIDKey: CURRENT_CONNECTION_KEY,
      name: t('settings:connection.currentConnection'),
      subtitle: settings.serverUrl.trim() ? connectionHost(settings.serverUrl) : t('settings:connection.noServerUrl'),
      isActive: true,
      actions: (
        <>
          <Button testID="connection-reconnect" disabled={isReconnecting || !settings.serverUrl.trim()} onPress={() => void connect()} variant="default">{isReconnecting ? <Spinner size="small" /> : null}<Text>{t('common:actions.reconnect')}</Text></Button>
          <Button testID="connection-edit-current" onPress={() => setDialog({ mode: 'edit-current' })} variant="outline"><Text>{t('common:actions.edit')}</Text></Button>
        </>
      ),
      body: (
        <>
          <Text className={cn("text-muted-foreground")} variant="label">{t('settings:connection.serverUrlValue', { url: settings.serverUrl.trim() || t('common:labels.notSet') })}</Text>
          <Text className={cn("text-muted-foreground")} variant="label">{t('settings:connection.usernameValue', { username: settings.username.trim() || t('settings:connection.usernameEmpty') })}</Text>
          <Text className={cn("text-muted-foreground")} variant="label">{t('settings:connection.notSavedYet')}</Text>
        </>
      ),
    }));
  }

  profiles.forEach((profile) => {
    const id = getConnectionUiScope(profile);
    const live = registry.connections.find((entry) => entry.id === id);
    const isActive = live?.enabled === true;
    const isSwitching = switchingProfileId === profile.id;
    const runtime = Object.entries(registry.snapshots).find(([key]) => (JSON.parse(key) as string[])[0] === id)?.[1];
    const status = runtime?.values.connectionValue.connection.status ?? 'idle';
    const isReconnecting = status === 'connecting';
    const manageOrEdit = profile.connect
      ? onManageConnect ? <Button onPress={() => manageConnect(profile)} variant="outline"><Text>{t('settings:connect.manage')}</Text></Button> : null
      : <Button testID={`connection-edit-${profile.id}`} onPress={() => void handleEditProfile(profile).catch((reason) => setError(getErrorMessage(reason)))} variant="outline"><Text>{t('common:actions.edit')}</Text></Button>;
    rows.push(renderRow({
      rowKey: profile.id,
      testIDKey: profile.id,
      name: profile.name,
      subtitle: connectionHost(profile.serverUrl),
      isActive,
      isSwitching,
      status,
      actions: isActive ? (
        <>
          <Button testID="connection-reconnect" disabled={isReconnecting || isSwitching} onPress={() => void registry.retry(id).catch((reason) => setError(String(reason)))} variant="default">{isReconnecting ? <Spinner size="small" /> : null}<Text>{t('common:actions.reconnect')}</Text></Button>
          <Button testID={`connection-disconnect-${profile.id}`} onPress={() => void registry.disconnect(id).catch((reason) => setError(String(reason)))} variant="ghost"><Text>{t('common:actions.disconnect')}</Text></Button>
          {manageOrEdit}
        </>
      ) : (
        <>
          <Button testID={`connection-connect-${profile.id}`} disabled={Boolean(switchingProfileId) || isSwitching} onPress={() => void handleConnect(profile)} variant="default">{isSwitching ? <Spinner size="small" /> : null}<Text>{t('common:actions.connect')}</Text></Button>
          {manageOrEdit}
          <Button testID={`connection-delete-${profile.id}`} onPress={() => handleDelete(profile)} variant="ghost"><Text className={cn("text-destructive")} >{t('common:actions.delete')}</Text></Button>
        </>
      ),
      body: (
        <>
          <Text className={cn("text-muted-foreground")} variant="label">{t('settings:connection.serverUrlValue', { url: profile.serverUrl })}</Text>
          <Text className={cn("text-muted-foreground")} variant="label">{t('settings:connection.usernameValue', { username: profile.username || t('settings:connection.usernameEmpty') })}</Text>
        </>
      ),
    }));
  });

  return <>{confirmation}{(
    <>
      <View className={cn(stylesClasses.list)}>{rows}</View>
      {error ? <Text className={cn("text-destructive")}>{error}</Text> : null}
      <SettingTarget label={t('settings:connection.addConnection')}><Button testID="connection-add-button" onPress={() => setChoosing(true)} variant="outline"><Icon name={"plus"} size={20} /><Text>{t('settings:connection.addConnection')}</Text></Button></SettingTarget>
      {profiles.length === 0 ? (
        <Text className={cn("text-muted-foreground")} variant="label">{t('settings:connection.addDescription')}</Text>
      ) : null}
      <OverlaySheet visible={choosing} title={t('settings:connection.addConnection')} onClose={() => setChoosing(false)} fitContent testID="connection-method-sheet">
        <ConnectionMethodChooser onScan={() => { setChoosing(false); setScanning(true); }} onManual={() => { setChoosing(false); setDialog({ mode: 'add' }); }} onPair={() => { setChoosing(false); onPair?.(); }} />
      </OverlaySheet>
      {scanning ? (
        <ConnectionScanFlow
          onSubmit={addAndConnect}
          onDismiss={() => { addedProfileId.current = undefined; setScanning(false); }}
        />
      ) : null}
      {dialog ? (
        <ConnectionProfileDialog
          title={dialog.mode === 'add' ? t('settings:connection.addConnection') : t('settings:connection.editConnection')}
          submitLabel={dialog.mode === 'add' ? t('settings:connection.saveAndConnect') : t('common:actions.save')}
          showName={dialog.mode !== 'edit-current'}
          initial={dialog.mode === 'add' ? undefined : dialog.mode === 'edit-current' ? {
            serverUrl: settings.serverUrl,
            username: settings.username,
            password: settings.password,
            headers: settings.headers ?? {},
          } : {
            name: dialog.profile.name,
            serverUrl: dialog.profile.serverUrl,
            username: dialog.profile.username,
            password: dialog.password,
            headers: dialog.headers,
          }}
          onSubmit={handleDialogSubmit}
          onDismiss={() => { addedProfileId.current = undefined; setDialog(undefined); }}
        />
      ) : null}
    </>
  )}</>;
}



const stylesClasses = {
  "row": "border rounded-[12px] overflow-hidden",
  "rowHeader": "items-center flex-row gap-1 pr-3 py-1.5",
  "rowCopy": "flex-1 gap-0.5",
  "status": "rounded-[12px] px-2.5 min-h-7.5 justify-center",
  "rowBody": "gap-1 pb-3 px-3",
  "actions": "flex-row flex-wrap gap-2 mt-2",
  "list": "gap-2"
} as const;
