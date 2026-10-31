import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { View } from 'react-native';

import { usePalette } from '@/hooks/use-palette';
import { SettingSlider, SettingSwitchRow, SettingField } from './setting-rows';

function SettingsControls() {
  const palette = usePalette();
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState('Work laptop');
  const [temperature, setTemperature] = useState(0.4);
  return (
    <View style={{ gap: 16, width: 420, maxWidth: '100%' }}>
      <SettingSwitchRow
        description="Show a notification when a task finishes."
        onValueChange={setEnabled}
        palette={palette}
        title="Task notifications"
        value={enabled}
      />
      <SettingSwitchRow
        description="This preference is unavailable for the current server."
        disabled
        onValueChange={() => undefined}
        palette={palette}
        title="Server-wide activity"
        value={false}
      />
      <SettingSlider
        label="Temperature"
        maximum={1}
        minimum={0}
        onValueChange={setTemperature}
        palette={palette}
        step={0.1}
        value={temperature}
        valueLabel={temperature.toFixed(1)}
      />
      <SettingField
        label="Connection name"
        onChangeText={setName}
        value={name}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button variant="default" onPress={() => undefined}><Text>Save</Text></Button>
        <Button variant="outline" onPress={() => undefined}><Text>Cancel</Text></Button>
        <Button variant="ghost" onPress={() => undefined}><Text>Learn more</Text></Button>
        <Button disabled variant="default" onPress={() => undefined}><Text>Unavailable</Text></Button>
      </View>
    </View>
  );
}

const meta = {
  title: 'Controls/Settings controls',
  component: SettingsControls,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SettingsControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
