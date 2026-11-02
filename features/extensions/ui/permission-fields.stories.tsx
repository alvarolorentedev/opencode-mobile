import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { View } from 'react-native';
import { PermissionFields } from './permission-fields';
import type { PermissionRule } from '@/shared/protocol/opencode/extensions/permission-draft';

function Example({ initial = [], disabled = false }: { initial?: PermissionRule[]; disabled?: boolean }) {
  const [rules, setRules] = useState(initial);
  return <View style={{ width: 390, maxWidth: '100%' }}><PermissionFields rules={rules} onChange={setRules} disabled={disabled} /></View>;
}
const meta = { title: 'Extensions/Permissions', component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Inherited: Story = {};
export const OrderedRules: Story = { args: { initial: [{ action: 'read', resource: '/workspace/**', effect: 'allow' }, { action: 'edit', resource: '/workspace/very-long-project-name/private/**', effect: 'ask' }] } };
export const Disabled: Story = { args: { disabled: true, initial: [{ action: 'shell', resource: '*', effect: 'deny' }] } };
