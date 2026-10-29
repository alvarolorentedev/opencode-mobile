import { SettingButton as Button } from './setting-rows';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { List, Text } from 'react-native-paper';

import { SettingTarget } from '../settings-panel';
import { confirmAction } from '@/lib/confirm-action';
import type { SavedPermissionRule } from '@/lib/opencode/client';
import type { Palette } from './setting-rows';

// V2-only view of server-persisted "always allow" grants. The list is
// provider-owned; this surface only confirms and forwards removal.
export function PermissionsSection({
  serverName,
  onRefresh,
  onRemove,
  palette,
  rules,
}: {
  serverName?: string;
  onRefresh: () => void;
  onRemove: (id: string) => void;
  palette: Palette;
  rules: SavedPermissionRule[];
}) {
  const { t } = useTranslation();

  const confirmRemove = (rule: SavedPermissionRule) => {
    confirmAction(t('settings:permissions.removeTitle'),
      [serverName, t('settings:permissions.removeMessage', { resource: rule.resource })].filter(Boolean).join('\n'),
      t('common:actions.remove'), t('common:actions.cancel'), () => onRemove(rule.id));
  };

  return (
    <SettingTarget label={t('settings:permissions.title')}><View style={styles.section}>
      <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>{t('settings:permissions.title')}</Text>
      <Text variant="bodySmall" style={{ color: palette.muted }}>{t('settings:permissions.description')}</Text>
      {rules.length === 0 ? (
        <List.Item title={t('settings:permissions.empty')} titleStyle={{ color: palette.muted }} />
      ) : rules.map((rule) => (
        <List.Item
          key={rule.id}
          title={rule.resource}
          description={rule.action}
          titleStyle={{ color: palette.text }}
          descriptionStyle={{ color: palette.muted }}
          right={() => <Button compact onPress={() => confirmRemove(rule)}>{t('settings:permissions.remove')}</Button>}
        />
      ))}
      <View style={styles.actions}>
        <Button mode="outlined" onPress={onRefresh}>{t('settings:permissions.refresh')}</Button>
      </View>
    </View></SettingTarget>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  title: { fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
