import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, Divider, List, Text } from 'react-native-paper';

import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { TextInput } from '@/components/ui/text-input';
import { WorkspaceSelect } from '@/components/ui/workspace-select';
import { usePalette } from '@/hooks/use-palette';
import type { ProjectCheckout, ProjectWorktree } from '@/lib/opencode/project';
import { useWorkspaceActions } from '@/providers/workspace-context';
import { useWorkspaceProjects } from '@/providers/use-workspace-projects';
import type { WorkspaceTarget } from '@/providers/workspace-types';

export function NewChatSheet({ target: initial, onClose }: { target?: WorkspaceTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  const { createChat, createChatInWorktree } = useWorkspaceActions();
  const { groups } = useWorkspaceProjects();
  const [connectionId, setConnectionId] = useState(initial?.connectionId ?? '');
  const [projectPath, setProjectPath] = useState('');
  const [checkoutPath, setCheckoutPath] = useState(initial?.projectPath ?? '');
  const [createMode, setCreateMode] = useState(false);
  const [name, setName] = useState('');
  const [createdCheckout, setCreatedCheckout] = useState<ProjectWorktree>();
  const [busy, setBusy] = useState<'create' | 'chat'>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const defaultServer = groups.find((group) => group.id === initial?.connectionId && group.enabled)
    ?? groups.find((group) => group.enabled)
    ?? groups[0];
  const defaultProject = defaultServer?.projects.find((entry) => entry.checkouts.some((checkout) => checkout.directory === initial?.projectPath))
    ?? defaultServer?.projects[0];
  const effectiveConnectionId = groups.some((group) => group.id === connectionId) ? connectionId : defaultServer?.id ?? '';
  const server = groups.find((group) => group.id === effectiveConnectionId) ?? defaultServer;
  const effectiveProjectPath = server?.projects.some((entry) => entry.path === projectPath) ? projectPath : defaultProject?.path ?? server?.projects[0]?.path ?? '';
  const project = server?.projects.find((entry) => entry.path === effectiveProjectPath) ?? server?.projects[0];
  const checkouts = useMemo<ProjectCheckout[]>(() => {
    const entries = project?.checkouts ?? [];
    if (!createdCheckout || entries.some((entry) => entry.directory === createdCheckout.directory)) return entries;
    return [...entries, {
      directory: createdCheckout.directory,
      name: createdCheckout.name || createdCheckout.directory.split('/').filter(Boolean).pop() || createdCheckout.directory,
      branch: createdCheckout.branch,
      isMain: false,
    }];
  }, [createdCheckout, project?.checkouts]);
  const initialCheckout = project?.checkouts.find((checkout) => checkout.directory === initial?.projectPath);
  const effectiveCheckoutPath = checkoutPath && checkouts.some((checkout) => checkout.directory === checkoutPath)
    ? checkoutPath
    : initialCheckout?.directory ?? project?.checkouts[0]?.directory ?? project?.path ?? '';

  function selectServer(nextConnectionId: string) {
    const nextServer = groups.find((group) => group.id === nextConnectionId);
    const nextProject = nextServer?.projects[0];
    setConnectionId(nextConnectionId);
    setProjectPath(nextProject?.path ?? '');
    setCheckoutPath(nextProject?.checkouts[0]?.directory ?? nextProject?.path ?? '');
    setCreateMode(false);
    setCreatedCheckout(undefined);
    setError(undefined);
    setNotice(undefined);
  }

  function selectProject(nextProjectPath: string) {
    const nextProject = server?.projects.find((entry) => entry.path === nextProjectPath);
    setProjectPath(nextProjectPath);
    setCheckoutPath(nextProject?.checkouts[0]?.directory ?? nextProjectPath);
    setCreateMode(false);
    setCreatedCheckout(undefined);
    setError(undefined);
    setNotice(undefined);
  }

  async function submit() {
    if (!server || !project || busy) return;
    setError(undefined);
    if (createMode) {
      setBusy('create');
      try {
        const result = await createChatInWorktree({
          connectionId: server.id,
          projectRoot: project.path,
          name: name.trim() || undefined,
        });
        if (result.session) {
          onClose();
          return;
        }
        if (result.checkout) {
          setCreatedCheckout(result.checkout);
          setCheckoutPath(result.checkout.directory);
          setCreateMode(false);
          setNotice(t('chat:newChat.worktreeCreatedChatFailed'));
          if (result.error) setError(result.error);
          return;
        }
        setError(result.error || t('project:errors.createWorktree'));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('project:errors.createWorktree'));
      } finally {
        setBusy(undefined);
      }
      return;
    }
    setBusy('chat');
    try {
      await createChat({ connectionId: server.id, projectPath: effectiveCheckoutPath });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('chat:newChat.startChatFailed'));
      setBusy(undefined);
    }
  }

  const canSubmit = Boolean(server && project && effectiveCheckoutPath && server.status === 'connected' && !busy);
  const primaryLabel = busy === 'create'
    ? t('chat:newChat.creatingWorktree')
    : busy === 'chat'
      ? t('chat:newChat.startingChat')
      : createMode
        ? t('chat:newChat.createWorktreeChat')
        : t('chat:newChat.create');

  return (
    <OverlaySheet
      visible
      title={t('chat:newChat.title')}
      testID="new-chat-sheet"
      fitContent
      dismissible={!busy}
      onClose={onClose}>
      <Text>{t('chat:newChat.hint')}</Text>
      {groups.length > 1 ? (
        <WorkspaceSelect
          title={t('common:servers.server')}
          value={effectiveConnectionId}
          testID="new-chat-server-picker"
          disabled={Boolean(busy)}
          options={groups.filter((entry) => entry.enabled).map((entry) => ({ value: entry.id, label: entry.name, description: t(`common:servers.status.${entry.status}`) }))}
          onChange={selectServer} />
      ) : null}
      <WorkspaceSelect
        title={t('common:servers.projectContext')}
        value={effectiveProjectPath}
        testID="new-chat-project-picker"
        disabled={Boolean(busy) || !server}
        options={server?.projects.map((entry) => ({ value: entry.path, label: entry.label, description: entry.path })) ?? []}
        onChange={selectProject} />

      <Text variant="labelMedium" style={{ marginTop: 6 }}>{t('chat:newChat.runIn')}</Text>
      {checkouts.length ? checkouts.map((checkout) => {
        const selected = !createMode && checkout.directory === effectiveCheckoutPath;
        const label = checkout.isMain ? t('project:worktrees.local') : checkout.name;
        return (
          <View key={checkout.directory}>
            <List.Item
              testID={`new-chat-checkout-${checkout.directory}`}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: Boolean(busy) }}
              accessibilityLabel={t('project:picker.selectLabel', { name: label })}
              title={label}
              titleNumberOfLines={2}
              description={checkout.isMain ? t('project:worktrees.localHint') : [checkout.branch, checkout.directory].filter(Boolean).join(' · ')}
              descriptionNumberOfLines={2}
              left={(props) => <List.Icon {...props} color={selected ? palette.tint : palette.muted} icon={checkout.isMain ? 'home-outline' : 'source-branch'} />}
              right={(props) => <List.Icon {...props} color={selected ? palette.tint : palette.muted} icon={selected ? 'check-circle' : 'circle-outline'} />}
              disabled={Boolean(busy)}
              onPress={() => {
                setCheckoutPath(checkout.directory);
                setCreateMode(false);
                setError(undefined);
                setNotice(undefined);
              }} />
            <Divider />
          </View>
        );
      }) : <Text style={{ color: palette.muted }}>{t('chat:newChat.noCheckouts')}</Text>}

      <List.Item
        testID="new-chat-new-worktree"
        accessibilityRole="button"
        accessibilityState={{ selected: createMode, disabled: Boolean(busy) }}
        title={t('chat:newChat.newWorktree')}
        left={(props) => <List.Icon {...props} color={createMode ? palette.tint : palette.muted} icon="plus" />}
        right={(props) => <List.Icon {...props} color={createMode ? palette.tint : palette.muted} icon={createMode ? 'check-circle' : 'circle-outline'} />}
        disabled={Boolean(busy)}
        onPress={() => {
          setCreateMode(true);
          setError(undefined);
          setNotice(undefined);
        }} />
      {createMode ? (
        <>
          <TextInput
            testID="new-chat-worktree-name"
            mode="outlined"
            label={t('chat:newChat.worktreeName')}
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy} />
          <Text variant="bodySmall" style={{ color: palette.muted }}>{t('chat:newChat.worktreeHint')}</Text>
        </>
      ) : null}

      <Text variant="labelMedium">{t('common:servers.workingDirectory')}</Text>
      <Text style={{ fontFamily: 'monospace' }}>{createMode ? t('chat:newChat.newWorktree') : effectiveCheckoutPath || '—'}</Text>
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: palette.warning }}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        <Button disabled={Boolean(busy)} onPress={onClose}>{t('common:actions.cancel')}</Button>
        <Button testID="new-chat-confirm" mode="contained" loading={Boolean(busy)} disabled={!canSubmit} onPress={() => void submit()}>
          {primaryLabel}
        </Button>
      </View>
    </OverlaySheet>
  );
}
