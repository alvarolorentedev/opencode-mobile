import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProjectDirectoryPicker } from '@/features/projects/ui/project-directory-picker';

const meta = {
  title: 'Projects/Directory picker', component: ProjectDirectoryPicker,
  args: {
    startPath: '/workspace',
    loadDirectories: async () => ['demo-project', 'secondary-project', 'archived-project'],
    onConfirm: () => {},
    scrollable: false,
  },
} satisfies Meta<typeof ProjectDirectoryPicker>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Folders: Story = {};
export const Empty: Story = { args: { loadDirectories: async () => [] } };
export const Loading: Story = { args: { loadDirectories: () => new Promise(() => {}) } };
export const Failure: Story = { args: { loadDirectories: async () => { throw new globalThis.Error('Could not list this folder.'); } } };
