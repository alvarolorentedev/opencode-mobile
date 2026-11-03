import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { AgentPicker } from './agent-picker';
import type { AgentOption } from '@/shared/contracts/model-options';

const agents: AgentOption[] = [
  { id: 'build', label: 'Build', mode: 'primary' },
  { id: 'plan', label: 'Plan', mode: 'primary' },
  { id: 'reviewer', label: 'Reviewer', mode: 'all', description: 'Review project changes with the configured tools.' },
  { id: 'general', label: 'General', mode: 'subagent' },
  { id: 'summary', label: 'Summary', mode: 'primary', hidden: true },
];
function Example({ empty = false, loading = false, unavailable = false }: { empty?: boolean; loading?: boolean; unavailable?: boolean }) {
  const [selected, setSelected] = useState(unavailable ? 'summary' : 'build');
  return <AgentPicker agents={empty || loading ? [] : agents} selectedValue={selected} onSelect={setSelected} onClose={() => {}} visible loading={loading} />;
}
const meta = { title: 'Chat/Agent picker', component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Selection: Story = {};
export const EmptyCatalog: Story = { args: { empty: true } };
export const Loading: Story = { args: { loading: true } };
export const UnavailableSelection: Story = { args: { unavailable: true } };
