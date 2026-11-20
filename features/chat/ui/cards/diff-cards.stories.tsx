import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FileDiff } from '@/shared/protocol/opencode/types';
import { View } from 'react-native';
import { SessionDiffBody, SessionDiffHeader } from './diff-cards';

const diff: FileDiff = {
  file: 'features/settings/ui/settings-search.ts',
  patch: '@@ -1,2 +1,3 @@\n import { settingsTargets } from \'./settings-targets\';\n-import { legacySearch } from \'./legacy-search\';\n+import { searchSettings } from \'./settings-search\';\n+export const targets = settingsTargets;',
  additions: 2,
  deletions: 1,
};

const meta = {
  title: 'Chat/Diff file',
  component: SessionDiffHeader,
  args: { diff, expanded: false, onPress: () => undefined },
} satisfies Meta<typeof SessionDiffHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = {
  args: { expanded: true },
  render: (args) => (
    <View className="bg-background">
      <SessionDiffHeader {...args} />
      <SessionDiffBody diff={args.diff} />
    </View>
  ),
};
