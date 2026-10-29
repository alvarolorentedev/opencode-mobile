import type { Meta, StoryObj } from '@storybook/react-vite';
import { View } from 'react-native';

import { UpdateBanner } from './update-notice';

const meta = {
  title: 'Feedback/Update banner',
  component: UpdateBanner,
  parameters: { layout: 'centered' },
  args: {
    notice: { phase: 'available', version: '1.0.106' },
    onUpdate: () => undefined,
    onLater: () => undefined,
  },
  render: (args) => (
    <View style={{ width: 560, maxWidth: '100%' }}>
      <UpdateBanner {...args} />
    </View>
  ),
} satisfies Meta<typeof UpdateBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};

export const Downloaded: Story = {
  args: {
    notice: { phase: 'downloaded', version: '1.0.106' },
  },
};
