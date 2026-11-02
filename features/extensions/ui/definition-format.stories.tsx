import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { View } from 'react-native';
import { DefinitionFormat } from './definition-format';
import type { ExtensionFormat } from '@/shared/protocol/opencode/extensions/types';

function Example({ initial = 'markdown' }: { initial?: ExtensionFormat }) {
  const [format, setFormat] = useState(initial);
  return <View style={{ width: 390, maxWidth: '100%' }}><DefinitionFormat value={format} onChange={setFormat} /></View>;
}
const meta = { title: 'Extensions/Storage format', component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Markdown: Story = {};
export const Jsonc: Story = { args: { initial: 'jsonc' } };
