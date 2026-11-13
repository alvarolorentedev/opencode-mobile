import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SubagentDetail } from '@/shared/presentation/transcript';
import { Colors } from '@/shared/ui/theme/theme';
import { SubagentRow } from './subagent-row';

const detail: SubagentDetail = {
  id: 'subagent-1',
  kind: 'subagent',
  sessionID: 'ses_subagent_1',
  agent: 'explore',
  description: 'Audit chat rendering',
  status: 'running',
};

const meta = {
  title: 'Chat/Subagent row',
  component: SubagentRow,
  args: { detail, palette: Colors.light, onPress: () => undefined },
} satisfies Meta<typeof SubagentRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Completed: Story = { args: { detail: { ...detail, status: 'completed' } } };

export const Failed: Story = { args: { detail: { ...detail, status: 'failed' } } };

export const Cancelled: Story = { args: { detail: { ...detail, status: 'cancelled' } } };

export const AgentOnly: Story = { args: { detail: { ...detail, description: undefined } } };

export const LongLabel: Story = {
  args: {
    detail: {
      ...detail,
      description: 'Audit chat rendering, protocol normalization and navigation across every supported locale',
    },
  },
};

export const Flat: Story = { args: { flat: true } };
