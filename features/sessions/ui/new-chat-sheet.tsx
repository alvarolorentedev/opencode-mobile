import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { ListRow } from '@/shared/ui/list-row';
import { Icon } from '@/shared/ui/icon';
import { Separator } from '@/shared/ui/separator';
import { TextField } from '@/shared/ui/text-field';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { OverlaySheet } from '@/shared/ui/overlay-sheet';

import { WorkspaceSelect } from '@/shared/ui/workspace-select';
import { usePalette } from '@/shared/ui/theme/use-palette';
import type { ProjectCheckout, ProjectWorktree } from '@/shared/protocol/opencode/project';
import { useWorkspaceActions } from '@/runtime/workspace';
import { useWorkspaceProjects } from '@/features/projects/index';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';

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

  const defaultServer = groups.find((group) => group.id === initial?.connectionId)
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
          options={groups.map((entry) => ({ value: entry.id, label: entry.name, description: t(`common:servers.status.${entry.status}`) }))}
          onChange={selectServer} />
      ) : null}
      <WorkspaceSelect
        title={t('common:servers.projectContext')}
        value={effectiveProjectPath}
        testID="new-chat-project-picker"
        disabled={Boolean(busy) || !server}
        options={server?.projects.map((entry) => ({ value: entry.path, label: entry.label, description: entry.path })) ?? []}
        onChange={selectProject} />

      <Text className={cn("mt-1.5")} variant="label">{t('chat:newChat.runIn')}</Text>
      {checkouts.length ? checkouts.map((checkout) => {
        const selected = !createMode && checkout.directory === effectiveCheckoutPath;
        const label = checkout.isMain ? t('project:worktrees.local') : checkout.name;
        return (
          <View key={checkout.directory}>
            <ListRow testID={`new-chat-checkout-${checkout.directory}`} accessibilityRole="button" accessibilityState={{ selected, disabled: Boolean(busy) }} accessibilityLabel={t('project:picker.selectLabel', { name: label })} title={label} description={checkout.isMain ? t('project:worktrees.localHint') : [checkout.branch, checkout.directory].filter(Boolean).join(' · ')} left={(props) => <Icon {...props} color={selected ? palette.tint : palette.muted} name={checkout.isMain ? 'home-outline' : 'source-branch'}></Icon>} right={(props) => <Icon {...props} color={selected ? palette.tint : palette.muted} name={selected ? 'check-circle' : 'circle-outline'}></Icon>} disabled={Boolean(busy)} onPress={() => {
                setCheckoutPath(checkout.directory);
                setCreateMode(false);
                setError(undefined);
                setNotice(undefined);
              }}></ListRow>
            <Separator></Separator>
          </View>
        );
      }) : <Text className={cn("text-muted-foreground")}>{t('chat:newChat.noCheckouts')}</Text>}

      <ListRow testID="new-chat-new-worktree" accessibilityRole="button" accessibilityState={{ selected: createMode, disabled: Boolean(busy) }} title={t('chat:newChat.newWorktree')} left={(props) => <Icon {...props} color={createMode ? palette.tint : palette.muted} name={"plus"}></Icon>} right={(props) => <Icon {...props} color={createMode ? palette.tint : palette.muted} name={createMode ? 'check-circle' : 'circle-outline'}></Icon>} disabled={Boolean(busy)} onPress={() => {
          setCreateMode(true);
          setError(undefined);
          setNotice(undefined);
        }}></ListRow>
      {createMode ? (
        <>
          <TextField testID="new-chat-worktree-name" label={t('chat:newChat.worktreeName')} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} editable={!busy}></TextField>
          <Text className={cn("text-muted-foreground")} variant="label">{t('chat:newChat.worktreeHint')}</Text>
        </>
      ) : null}

      <Text  variant="label">{t('common:servers.workingDirectory')}</Text>
      <Text style={{ fontFamily: 'monospace' }}>{createMode ? t('chat:newChat.newWorktree') : effectiveCheckoutPath || '—'}</Text>
      {notice ? <Text accessibilityLiveRegion="polite" className={cn("text-warning")}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" className={cn("text-destructive")}>{error}</Text> : null}
      <View className={cn("flex-row justify-end gap-2")}>
        <Button disabled={Boolean(busy)} onPress={onClose} variant={"ghost"}><Text>{t('common:actions.cancel')}</Text></Button>
        <Button testID="new-chat-confirm" disabled={!canSubmit} onPress={() => void submit()} variant={"default"}>{Boolean(busy) ? <Spinner size="small" /> : null}<Text>{primaryLabel}</Text></Button>
      </View>
    </OverlaySheet>
  );
}
