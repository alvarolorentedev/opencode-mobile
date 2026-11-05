import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProjectOptions } from '@/features/projects/ui/project-options';

const meta = {
  title: 'Projects/Project options', component: ProjectOptions,
  args: {
    projects: [
      { path: '/workspace/demo-project', label: 'demo-project' },
      { path: '/workspace/secondary-project', label: 'secondary-project' },
      { path: '/workspace/archived-project', label: 'archived-project' },
    ],
    activePath: '/workspace/demo-project',
    onSelect: () => {},
  },
} satisfies Meta<typeof ProjectOptions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Selectable: Story = {};
export const WithArchiveAction: Story = { args: { onArchive: () => {} } };
export const Disabled: Story = { args: { disabled: true, onArchive: () => {} } };
