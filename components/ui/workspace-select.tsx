import { Button } from 'react-native-paper';
import { NativeSelect, type NativeSelectOption } from '@/components/ui/native-select';
export function WorkspaceSelect({ title, value, options, onChange, testID, disabled }: {
  title: string; value?: string; options: NativeSelectOption[]; onChange: (value: string) => void; testID?: string; disabled?: boolean;
}) {
  return <NativeSelect title={title} searchable selectedValue={value} options={options} onValueChange={onChange} disabled={disabled}
    renderTrigger={({ open, selectedOption, disabled: blocked }) => <Button testID={testID} mode="outlined" icon="chevron-down" contentStyle={{ flexDirection: 'row-reverse' }}
      disabled={blocked} accessibilityLabel={`${title}: ${selectedOption?.label ?? title}`} onPress={open}>{selectedOption?.label ?? title}</Button>} />;
}
