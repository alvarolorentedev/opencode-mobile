import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { ListRow } from '@/shared/ui/list-row';
import { Icon } from '@/shared/ui/icon';
import { Separator } from '@/shared/ui/separator';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { usePalette } from '@/shared/ui/theme/use-palette';
import { useProjectFiles } from '@/features/projects/context';
import { useProjectCheckouts } from '@/features/projects/state/use-project-checkouts';
import { useWorkspaces } from '@/runtime/workspace';

export function WorktreeSwitcher({ onClose }: { onClose: () => void }) {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();
  const palette = usePalette();
  const registry = useWorkspaces();
  const { activeProject, checkouts, activeCheckout, worktrees } = useProjectCheckouts();
  const { refreshWorktrees, removeWorktree } = useProjectFiles();
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void refreshWorktrees().catch(() => undefined);
  }, [refreshWorktrees]);

  async function select(directory: string) {
    if (busy || directory === activeCheckout?.directory) {
      if (directory === activeCheckout?.directory) onClose();
      return;
    }
    const connectionId = registry.focus?.connectionId;
    if (!connectionId) {
      setError(t('project:errors.refreshProject'));
      return;
    }
    setBusy(directory);
    setError(undefined);
    try {
      await registry.activate({ connectionId, projectPath: directory });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('project:errors.refreshProject'));
    } finally {
      setBusy(undefined);
    }
  }

  function remove(directory: string) {
    confirmAction(
      t('project:worktrees.removeTitle'),
      t('project:worktrees.removeMessage', { directory }),
      t('common:actions.remove'),
      t('common:actions.cancel'),
      () => {
        setBusy(directory);
        setError(undefined);
        void removeWorktree(directory)
          .catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.removeWorktree')))
          .finally(() => setBusy(undefined));
      },
    );
  }

  const title = managing ? t('project:worktrees.manageTitle') : t('project:worktrees.title');
  const linked = checkouts.filter((checkout) => !checkout.isMain);
  return <>{confirmation}{(
    <OverlaySheet
      visible
      title={title}
      testID="worktree-picker"
      onClose={() => { if (!busy) onClose(); }}>
      <Text className={cn("text-muted-foreground")}>{t('project:worktrees.subtitle', { project: activeProject?.label ?? '' })}</Text>
      {worktrees.error ? <Text accessibilityLiveRegion="polite" className={cn("text-destructive")}>{worktrees.error}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" className={cn("text-destructive")}>{error}</Text> : null}
      {worktrees.error && !worktrees.loading ? (
        <Button onPress={() => void refreshWorktrees().catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.refreshProject')))} variant={"ghost"}><Text>{t('common:actions.retry')}</Text></Button>
      ) : null}
      {worktrees.loading && !checkouts.length ? <Spinner /> : null}
      {!checkouts.length && !worktrees.loading ? <Text className={cn("text-muted-foreground")}>{t('project:worktrees.empty')}</Text> : null}
      {checkouts.map((checkout) => {
        const selected = checkout.directory === activeCheckout?.directory;
        const name = checkout.isMain ? t('project:worktrees.local') : checkout.name;
        const description = checkout.isMain ? t('project:worktrees.localHint') : [checkout.branch, checkout.directory].filter(Boolean).join(' · ');
        const protectedCheckout = checkout.isMain || selected;
        if (managing) {
          return (
            <View key={checkout.directory}>
              <View className={cn("items-center flex-row")}>
                <ListRow testID={`worktree-manage-${checkout.directory}`} className={cn("flex-1")} title={name} description={description} left={(props) => <Icon {...props} color={checkout.isMain ? palette.tint : palette.muted} name={checkout.isMain ? 'home-outline' : 'source-branch'}></Icon>}></ListRow>
                <Button accessibilityLabel={t('project:worktrees.removeLabel', { name })} disabled={protectedCheckout || Boolean(busy)} onPress={() => remove(checkout.directory)} variant={"ghost"} size="icon"><Icon name={"delete-outline"} size={24} /></Button>
              </View>
              {selected && !checkout.isMain ? <Text className={cn("text-muted-foreground px-4 pb-2")}>{t('project:worktrees.cannotRemoveActive')}</Text> : null}
              <Separator></Separator>
            </View>
          );
        }
        return (
          <View key={checkout.directory}>
            <ListRow testID={`worktree-option-${checkout.directory}`} accessibilityRole="button" accessibilityState={{ selected, disabled: Boolean(busy) }} accessibilityLabel={t('project:picker.selectLabel', { name })} title={name} description={description} left={(props) => <Icon {...props} color={selected ? palette.tint : palette.muted} name={selected ? 'check-circle' : checkout.isMain ? 'home-outline' : 'source-branch'}></Icon>} disabled={Boolean(busy)} onPress={() => void select(checkout.directory)}></ListRow>
            <Separator></Separator>
          </View>
        );
      })}
      {!managing && linked.length ? (
        <Button onPress={() => setManaging(true)} variant={"ghost"}><Icon name={"cog-outline"} size={20} /><Text>{t('project:worktrees.manageTitle')}</Text></Button>
      ) : null}
      {managing ? (
        <Button onPress={() => setManaging(false)} variant={"ghost"}><Text>{t('common:actions.done')}</Text></Button>
      ) : !linked.length ? (
        <Text className={cn("text-muted-foreground")}>{t('project:worktrees.noOther')}</Text>
      ) : null}
    </OverlaySheet>
  )}</>;
}
