import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { FileDiff } from '@/shared/protocol/opencode/types';

import { buildDiffList } from '@/features/chat/ui/chat-diff';
import { DiffFileList } from './diff-file-list';

const diffs: FileDiff[] = [
  {
    file: 'features/settings/ui/settings-search.ts',
    patch: '@@ -1,2 +1,3 @@\n import { settingsTargets } from \'./settings-targets\';\n-import { legacySearch } from \'./legacy-search\';\n+import { searchSettings } from \'./settings-search\';\n+export const targets = settingsTargets;',
    additions: 2,
    deletions: 1,
  },
  {
    file: 'features/chat/ui/chat-diff.ts',
    patch: `@@ -1,40 +1,4 @@\n${Array.from({ length: 12 }, (_, index) => ` context ${index + 1}`).join('\n')}\n-old\n+new\n${Array.from({ length: 12 }, (_, index) => ` context ${index + 13}`).join('\n')}`,
    additions: 1,
    deletions: 1,
  },
  {
    file: 'features/chat/ui/chat-diff.test.ts',
    patch: '@@ -1 +1 @@\n-old\n+new',
    additions: 1,
    deletions: 1,
  },
];

function DiffFileListStory() {
  const [expandedId, setExpandedId] = useState<string | undefined>('diff:turn:features/chat/ui/chat-diff.ts');
  const { rows, stickyHeaderIndices } = useMemo(() => buildDiffList(diffs, 'turn', expandedId), [expandedId]);

  return (
    <View style={{ height: 420 }}>
      <DiffFileList rows={rows} stickyHeaderIndices={stickyHeaderIndices} onToggleFile={setExpandedId} />
    </View>
  );
}

const meta = {
  title: 'Chat/Diff list',
  component: DiffFileList,
  args: { rows: [], stickyHeaderIndices: [], onToggleFile: () => undefined },
} satisfies Meta<typeof DiffFileList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Files: Story = {
  render: () => <DiffFileListStory />,
};
