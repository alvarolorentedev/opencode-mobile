import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';
import { SettingField, SettingSelectField } from '@/shared/ui/settings/setting-rows';
import { FieldDescription } from '@/shared/ui/text-field';
import { usePalette } from '@/shared/ui/theme/use-palette';
import type { PermissionRule } from '@/shared/protocol/opencode/extensions/permission-draft';

export function PermissionFields({ rules, onChange, disabled = false }: { rules: PermissionRule[]; onChange: (rules: PermissionRule[]) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const palette = usePalette();
  function update(index: number, patch: Partial<PermissionRule>) { onChange(rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule)); }
  return <View className="gap-3">
    <FieldDescription>{t(rules.length ? 'settings:extensions.editor.rulesHint' : 'settings:extensions.editor.inheritPermissions')}</FieldDescription>
    {rules.map((rule, index) => <View key={index} className="gap-3 border-b border-border pb-3">
      <SettingField label={t('settings:extensions.editor.ruleAction')} value={rule.action} onChangeText={(action) => update(index, { action })} disabled={disabled} autoCapitalize="none" autoCorrect={false} />
      <SettingField label={t('settings:extensions.editor.ruleResource')} value={rule.resource} onChangeText={(resource) => update(index, { resource })} disabled={disabled} autoCapitalize="none" autoCorrect={false} />
      <SettingSelectField label={t('settings:extensions.editor.ruleEffect')} palette={palette} disabled={disabled} selectedValue={rule.effect} valueLabel={t(`settings:extensions.editor.${rule.effect}`)}
        options={(['ask', 'allow', 'deny'] as const).map((value) => ({ value, label: t(`settings:extensions.editor.${value}`) }))} onValueChange={(effect) => update(index, { effect })} />
      <Button variant="ghost" disabled={disabled} onPress={() => onChange(rules.filter((_, i) => i !== index))}><Text className="text-destructive">{t('common:actions.remove')}</Text></Button>
    </View>)}
    <Button variant="outline" disabled={disabled} onPress={() => onChange([...rules, { action: '', resource: '', effect: 'ask' }])}><Text>{t('settings:extensions.editor.addRule')}</Text></Button>
  </View>;
}
