import type { Meta, StoryObj } from '@storybook/react-vite';
import { ListRow } from './list-row';
import { SwipeRow } from './swipe-row';
const meta = {
  title: 'UI/Swipe row', component: SwipeRow,
  args: { title: 'demo.ts', children: <ListRow title="demo.ts" />, actions: [
    { label: 'Copy path', icon: 'link-variant', onPress: () => {} },
    { label: 'Rename', icon: 'pencil-outline', onPress: () => {} },
    { label: 'More', icon: 'dots-horizontal', onPress: () => {} },
  ] },
} satisfies Meta<typeof SwipeRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { actions: meta.args.actions.map((action) => ({ ...action, disabled: true })) } };
