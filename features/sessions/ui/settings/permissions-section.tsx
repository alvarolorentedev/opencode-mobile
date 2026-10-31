import { cn } from '@/shared/ui/cn';
import { Text } from '@/shared/ui/text';
import { ListRow } from '@/shared/ui/list-row';
import { Button } from '@/shared/ui/button';

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { SettingTarget } from '@/shared/ui/settings/settings-panel';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import type { SavedPermissionRule } from '@/shared/protocol/opencode/client';
import { Palette } from '@/shared/ui/settings/setting-rows';

// V2-only view of server-persisted "always allow" grants. The list is
// provider-owned; this surface only confirms and forwards removal.
export function PermissionsSection({
  serverName,
  onRemove,
  palette,
  rules,
}: {
  serverName?: string;
  onRemove: (id: string) => void;
  palette: Palette;
  rules: SavedPermissionRule[];
}) {
  const { confirmAction, confirmation } = useConfirmation();
  const { t } = useTranslation();

  const confirmRemove = (rule: SavedPermissionRule) => {
    confirmAction(t('settings:permissions.removeTitle'),
      [serverName, t('settings:permissions.removeMessage', { resource: rule.resource })].filter(Boolean).join('\n'),
      t('common:actions.remove'), t('common:actions.cancel'), () => onRemove(rule.id));
  };

  return <>{confirmation}{(
    <SettingTarget label={t('settings:permissions.title')}><View className={cn(stylesClasses.section)}>
      <Text className={cn(stylesClasses.title, "text-foreground")} variant="heading">{t('settings:permissions.title')}</Text>
      <Text className={cn("text-muted-foreground")} variant="label">{t('settings:permissions.description')}</Text>
      {rules.length === 0 ? (
        <ListRow title={t('settings:permissions.empty')} titleStyle={{ color: palette.muted }}></ListRow>
      ) : rules.map((rule) => (
        <ListRow key={rule.id} title={rule.resource} description={rule.action} titleStyle={{ color: palette.text }} descriptionStyle={{ color: palette.muted }} right={() => <Button onPress={() => confirmRemove(rule)} variant="ghost"><Text>{t('settings:permissions.remove')}</Text></Button>}></ListRow>
      ))}
    </View></SettingTarget>
  )}</>;
}

const stylesClasses = {
  "section": "gap-3 px-4 pb-4",
  "title": "font-semibold"
} as const;
