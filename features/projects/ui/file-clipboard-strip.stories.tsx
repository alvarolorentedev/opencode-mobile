import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileClipboardStrip } from '@/features/projects/ui/file-clipboard-strip';
const meta = {
  title: 'Projects/File clipboard', component: FileClipboardStrip,
  args: { entry: { root: '/worktrees/mobile-fixes', path: 'src/helpers.ts', type: 'file', mode: 'copy' }, busy: false, available: true, onPaste: () => {}, onClear: () => {} },
} satisfies Meta<typeof FileClipboardStrip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Copied: Story = {};
export const Cut: Story = { args: { entry: { root: '/repo', path: 'src/utils', type: 'directory', mode: 'cut' } } };
export const Busy: Story = { args: { busy: true } };
export const LongPath: Story = { args: { entry: { root: '/worktrees/mobile-accessibility-improvements', path: 'src/components/project/shared-file-operations.ts', type: 'file', mode: 'copy' } } };
