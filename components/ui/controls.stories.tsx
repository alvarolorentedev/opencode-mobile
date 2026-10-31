import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from './button';
import { Text } from './text';
import { Icon } from './icon';
import { Checkbox } from './checkbox';
import { Switch } from './switch';
import { RadioGroup, RadioGroupItem } from './radio-group';
import { Label } from './label';
import { Spinner } from './spinner';
import { Progress } from './progress';
import { CatalogSelect } from './catalog-select';
import { OverlaySheet } from './overlay-sheet';
import { Feedback } from './feedback';
import { useConfirmation } from './use-confirmation';

function Controls() {
  const [checked, setChecked] = useState(false);
  const [radio, setRadio] = useState('local');
  const [choice, setChoice] = useState('system');
  return <View className="gap-4 p-4 w-80">
    <Button><Icon name="check" /><Text>Save settings</Text></Button>
    <Button variant="outline"><Text>Secondary action</Text></Button>
    <Button variant="destructive"><Text>Remove connection</Text></Button>
    <Button disabled><Spinner size="small" /><Text>Saving settings</Text></Button>
    <View className="flex-row items-center gap-4"><Checkbox checked={checked} onCheckedChange={setChecked} accessibilityLabel="Enable notifications" /><Text>Notifications</Text><Switch checked={checked} onCheckedChange={setChecked} accessibilityLabel="Enable notifications switch" /></View>
    <RadioGroup value={radio} onValueChange={setRadio} className="gap-3">
      {['local', 'remote'].map((value) => <View key={value} className="flex-row items-center gap-3"><RadioGroupItem value={value} aria-labelledby={`label-${value}`} /><Label nativeID={`label-${value}`} onPress={() => setRadio(value)}>{value}</Label></View>)}
    </RadioGroup>
    <CatalogSelect options={['system', 'light', 'dark'].map((value) => ({ value, label: value }))} selectedValue={choice} onValueChange={setChoice} renderTrigger={({ open }) => <Button variant="outline" onPress={open}><Text>{choice}</Text></Button>} />
    <Progress value={60} accessibilityLabel="Download progress" />
  </View>;
}
function Overlays() {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const { confirmAction, confirmation } = useConfirmation();
  return <View className="flex-1 gap-3 p-4 min-h-96">
    <Button onPress={() => setOpen(true)}><Text>Open sheet</Text></Button>
    <Button onPress={() => confirmAction('Remove connection?', 'Saved credentials will be removed.', 'Remove', 'Cancel', () => setFeedback(true))}><Text>Confirm removal</Text></Button>
    <OverlaySheet visible={open} title="Connection settings" onClose={() => setOpen(false)}><Text>Sheet content uses the production portal and keyboard handling.</Text><Controls /></OverlaySheet>
    {confirmation}
    <Feedback open={feedback} onOpenChange={setFeedback}>Connection removed</Feedback>
  </View>;
}
const meta = { title: 'Controls/Shared primitives', component: Controls, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Controls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const DialogsAndFeedback: Story = { render: () => <Overlays /> };
