import type { Meta, StoryObj } from '@storybook/react-vite';
import { View } from 'react-native';

import { Text } from '@/shared/ui/text';

const meta = {
  title: 'Foundations/Text direction',
  component: Text,
  parameters: { layout: 'centered' },
  render: () => (
    <View style={{ direction: 'rtl', gap: 12, maxWidth: 360 }}>
      <Text variant="heading">إدارة المشاريع والمهام</Text>
      <Text>اعرض الملف <Text variant="code">src/app.ts</Text> ثم أرسل التغييرات.</Text>
      <Text variant="description">כתיבה מימין לשמאל עם OpenCode ושמות קבצים.</Text>
    </View>
  ),
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RightToLeft: Story = {};
