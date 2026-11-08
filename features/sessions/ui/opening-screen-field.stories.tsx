import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { View } from 'react-native';

import { OpeningScreenField } from '@/features/sessions/ui/opening-screen-field';
import type { OpeningScreen } from '@/shared/preferences/opencode-preferences';

function Field({ initial }: { initial: OpeningScreen }) {
  const [value, setValue] = useState(initial);
  return <View className="w-80"><OpeningScreenField value={value} onChange={setValue} /></View>;
}

const meta = { title: 'Settings/Opening screen', component: Field, args: { initial: 'chat' } } satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Chat: Story = {};
export const MissionControl: Story = { args: { initial: 'mission' } };
