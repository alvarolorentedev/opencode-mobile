import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { View } from 'react-native';

import { AccentColorField } from '@/shared/ui/theme/accent-color-field';
import { usePalette } from '@/shared/ui/theme/use-palette';
import type { AccentColor } from '@/shared/ui/theme/appearance';

function AccentColorPicker() {
  const palette = usePalette();
  const [accent, setAccent] = useState<AccentColor>('green');
  return <View style={{ width: 390, maxWidth: '100%' }}><AccentColorField onChange={setAccent} palette={palette} value={accent} /></View>;
}

const meta = {
  title: 'Controls/Accent color field',
  component: AccentColorPicker,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof AccentColorPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
