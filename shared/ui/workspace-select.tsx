import { Button } from '@/shared/ui/button';
import { Icon } from '@/shared/ui/icon';
import { Text } from '@/shared/ui/text';

import { CatalogSelect, type CatalogOption } from '@/shared/ui/catalog-select';
export function WorkspaceSelect({ title, value, options, onChange, testID, disabled }: {
  title: string; value?: string; options: CatalogOption[]; onChange: (value: string) => void; testID?: string; disabled?: boolean;
}) {
  return <CatalogSelect title={title} searchable selectedValue={value} options={options} onValueChange={onChange} disabled={disabled}
    renderTrigger={({ open, selectedOption, disabled: blocked }) => <Button testID={testID} disabled={blocked} accessibilityLabel={`${title}: ${selectedOption?.label ?? title}`} onPress={open} variant={"outline"} style={[undefined, { flexDirection: 'row-reverse' }, undefined]}><Icon name={"chevron-down"} size={20} /><Text>{selectedOption?.label ?? title}</Text></Button>} />;
}
