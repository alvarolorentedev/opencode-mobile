import { useTranslation } from 'react-i18next';
import { SettingSelectField } from '@/shared/ui/settings/setting-rows';
import { usePalette } from '@/shared/ui/theme/use-palette';
import type { ExtensionFormat } from '@/shared/protocol/opencode/extensions/types';

export function DefinitionFormat({ value, onChange }: { value: ExtensionFormat; onChange: (value: ExtensionFormat) => void }) {
  const { t } = useTranslation();
  const palette = usePalette();
  return <SettingSelectField label={t('settings:extensions.editor.storage')} palette={palette} selectedValue={value} valueLabel={t(`settings:extensions.format.${value}`)}
    options={(['markdown', 'jsonc'] as const).map((format) => ({ value: format, label: t(`settings:extensions.format.${format}`) }))} onValueChange={onChange} />;
}
