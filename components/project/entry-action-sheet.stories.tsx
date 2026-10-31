import type { Meta, StoryObj } from '@storybook/react-vite';
import { EntryActionContent } from './entry-action-content';

const meta = {
  title: 'Projects/Entry actions', component: EntryActionContent,
  args: {
    entry: { path: 'src/utils', name: 'utils', type: 'directory' }, projectLabel: 'opencode-mobile', mode: 'actions',
    busy: false, available: true, canPaste: true, onClose: () => {}, onRename: () => {}, onCopyPath: () => {}, onSelect: () => {}, onPaste: () => {},
  },
} satisfies Meta<typeof EntryActionContent>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Folder: Story = {};
export const File: Story = { args: { entry: { path: 'src/demo.ts', name: 'demo.ts', type: 'file' } } };
export const Rename: Story = { args: { mode: 'rename', entry: { path: 'src/demo.ts', name: 'demo.ts', type: 'file' } } };
export const Saving: Story = { args: { mode: 'rename', busy: true } };
export const Error: Story = { args: { mode: 'rename', error: 'An entry with this name already exists.' } };
export const Unavailable: Story = { args: { available: false, reason: 'The server shell is unavailable.' } };
