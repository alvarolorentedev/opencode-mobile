import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ActivityIndicator, Button, Divider, IconButton, List, Text } from 'react-native-paper';

import { OverlaySheet } from '@/components/ui/overlay-sheet';
import { confirmAction } from '@/lib/confirm-action';
import { usePalette } from '@/hooks/use-palette';
import { useProjectFiles } from '@/providers/opencode-contexts';
import { useProjectCheckouts } from '@/providers/use-project-checkouts';
import { useWorkspaces } from '@/providers/workspace-context';

export function WorktreeSwitcher({ onClose }: { onClose: () => void }) {
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
  return (
    <OverlaySheet
      visible
      title={title}
      testID="worktree-picker"
      onClose={() => { if (!busy) onClose(); }}
      headerAction={(
        <IconButton
          icon="refresh"
          accessibilityLabel={t('project:worktrees.refresh')}
          disabled={worktrees.loading || Boolean(busy)}
          onPress={() => void refreshWorktrees().catch((reason) => setError(reason instanceof Error ? reason.message : t('project:errors.refreshProject')))}
        />
      )}>
      <Text style={{ color: palette.muted }}>{t('project:worktrees.subtitle', { project: activeProject?.label ?? '' })}</Text>
      {worktrees.error ? <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>{worktrees.error}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={{ color: palette.danger }}>{error}</Text> : null}
      {worktrees.loading && !checkouts.length ? <ActivityIndicator /> : null}
      {!checkouts.length && !worktrees.loading ? <Text style={{ color: palette.muted }}>{t('project:worktrees.empty')}</Text> : null}
      {checkouts.map((checkout) => {
        const selected = checkout.directory === activeCheckout?.directory;
        const name = checkout.isMain ? t('project:worktrees.local') : checkout.name;
        const description = checkout.isMain ? t('project:worktrees.localHint') : [checkout.branch, checkout.directory].filter(Boolean).join(' · ');
        const protectedCheckout = checkout.isMain || selected;
        if (managing) {
          return (
            <View key={checkout.directory}>
              <View style={{ alignItems: 'center', flexDirection: 'row' }}>
                <List.Item
                  testID={`worktree-manage-${checkout.directory}`}
                  style={{ flex: 1 }}
                  title={name}
                  titleNumberOfLines={2}
                  description={description}
                  descriptionNumberOfLines={2}
                  left={(props) => <List.Icon {...props} color={checkout.isMain ? palette.tint : palette.muted} icon={checkout.isMain ? 'home-outline' : 'source-branch'} />} />
                <IconButton
                  icon="delete-outline"
                  accessibilityLabel={t('project:worktrees.removeLabel', { name })}
                  disabled={protectedCheckout || Boolean(busy)}
                  onPress={() => remove(checkout.directory)} />
              </View>
              {selected && !checkout.isMain ? <Text style={{ color: palette.muted, paddingHorizontal: 16, paddingBottom: 8 }}>{t('project:worktrees.cannotRemoveActive')}</Text> : null}
              <Divider />
            </View>
          );
        }
        return (
          <View key={checkout.directory}>
            <List.Item
              testID={`worktree-option-${checkout.directory}`}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: Boolean(busy) }}
              accessibilityLabel={t('project:picker.selectLabel', { name })}
              title={name}
              titleNumberOfLines={2}
              description={description}
              descriptionNumberOfLines={2}
              left={(props) => <List.Icon {...props} color={selected ? palette.tint : palette.muted} icon={selected ? 'check-circle' : checkout.isMain ? 'home-outline' : 'source-branch'} />}
              disabled={Boolean(busy)}
              onPress={() => void select(checkout.directory)} />
            <Divider />
          </View>
        );
      })}
      {!managing && linked.length ? (
        <Button icon="cog-outline" onPress={() => setManaging(true)}>{t('project:worktrees.manageTitle')}</Button>
      ) : null}
      {managing ? (
        <Button onPress={() => setManaging(false)}>{t('common:actions.done')}</Button>
      ) : !linked.length ? (
        <Text style={{ color: palette.muted }}>{t('project:worktrees.noOther')}</Text>
      ) : null}
    </OverlaySheet>
  );
}
