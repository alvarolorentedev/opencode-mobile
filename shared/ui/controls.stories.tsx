import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/shared/ui/button';
import { Text } from '@/shared/ui/text';
import { Icon } from '@/shared/ui/icon';
import { Checkbox } from '@/shared/ui/checkbox';
import { Switch } from '@/shared/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { Progress } from '@/shared/ui/progress';
import { CatalogSelect } from '@/shared/ui/catalog-select';
import { OverlaySheet } from '@/shared/ui/overlay-sheet';
import { Feedback } from '@/shared/ui/feedback';
import { useConfirmation } from '@/shared/ui/use-confirmation';
import { HeaderTitle, ScreenHeader } from '@/shared/ui/screen-header';

function Controls() {
  const [checked, setChecked] = useState(false);
  const [radio, setRadio] = useState('local');
  const [choice, setChoice] = useState('system');
  const [project, setProject] = useState('');
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
    <CatalogSelect searchable title="Projects" selectedValue={project} onValueChange={setProject}
      options={[
        { value: '', label: 'All projects' },
        { value: 'local-mobile', label: 'mobile', description: '/home/me/work/mobile', group: 'local' },
        { value: 'local-api', label: 'api', description: '/home/me/work/api', group: 'local' },
        { value: 'staging-mobile', label: 'mobile', description: '/srv/git/mobile', group: 'staging' },
      ]}
      renderTrigger={({ open, selectedOption }) => <Button variant="outline" onPress={open}><Text>{selectedOption?.label ?? 'All projects'}</Text></Button>} />
    <Progress value={60} accessibilityLabel="Download progress" />
  </View>;
}
function Overlays() {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [pair, setPair] = useState(false);
  const [interactions, setInteractions] = useState(0);
  const block = useCallback(() => {
    setInteractions((count) => count + 1);
    return () => setInteractions((count) => count - 1);
  }, []);
  const { confirmAction, confirmation } = useConfirmation(block);
  return <View className="flex-1 gap-3 p-4 min-h-96">
    <Button onPress={() => setOpen(true)}><Text>Open sheet</Text></Button>
    <Button onPress={() => { setPair(false); confirmAction('Remove connection?', 'Saved credentials will be removed.', 'Remove', 'Cancel', () => setFeedback(true)); }}><Text>Confirm removal</Text></Button>
    <Button disabled={interactions > 0} onPress={() => { setFeedback(false); setPair(true); }}><Text>Restart available</Text></Button>
    <OverlaySheet block={block} visible={open} title="Connection settings" onClose={() => setOpen(false)}><Controls /></OverlaySheet>
    {confirmation}
    <Feedback open={feedback} onOpenChange={setFeedback}>Connection removed</Feedback>
    <Feedback open={pair} onOpenChange={setPair} secondaryAction={{ label: 'Later', onPress: () => undefined }} action={{ label: 'Restart', onPress: () => undefined }}>Update downloaded</Feedback>
  </View>;
}

function ExpandableOverlay() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return <View className="p-4">
    <Button onPress={() => { setExpanded(false); setOpen(true); }}><Text>Open sheet</Text></Button>
    <OverlaySheet visible={open} title="Connection settings" onClose={() => setOpen(false)} compact expanded={expanded} onToggleExpanded={() => setExpanded((value) => !value)}>
      <Controls />
    </OverlaySheet>
  </View>;
}

function Headers() {
  return <View className="gap-4">
    <ScreenHeader className="border border-border rounded-xl"><Button variant="ghost" size="icon" accessibilityLabel="Back"><Icon name="arrow-left" size={24} /></Button><HeaderTitle title="Chat" subtitle="mobile / main" /><Button variant="ghost" size="icon" accessibilityLabel="New chat"><Icon name="plus" size={24} /></Button></ScreenHeader>
    <ScreenHeader className="border border-border rounded-xl"><HeaderTitle title="Settings" /></ScreenHeader>
  </View>;
}

const meta = { title: 'Controls/Shared primitives', component: Controls, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Controls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ScreenHeaders: Story = { render: () => <Headers /> };
export const DialogsAndFeedback: Story = { render: () => <Overlays /> };
export const ExpandableSheet: Story = { render: () => <ExpandableOverlay /> };
