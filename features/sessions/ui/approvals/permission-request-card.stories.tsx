import type { Meta, StoryObj } from '@storybook/react-vite';
import { View } from 'react-native';

import { PermissionRequestCard } from './permission-request-card';

const request = {
  id: 'permission-1',
  sessionID: 'session-1',
  permission: 'edit_file',
  patterns: ['app/(tabs)/index.tsx', 'src/features/chat/**/*.tsx'],
  always: ['app/(tabs)/*', 'src/features/chat/**/*.tsx'],
  metadata: {},
};

const meta = {
  title: 'Sessions/Permission request',
  component: PermissionRequestCard,
  args: { request, onReply: async () => undefined },
  decorators: [(Story) => <View className="w-[min(100%,420px)] bg-background p-3"><Story /></View>],
} satisfies Meta<typeof PermissionRequestCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RequestedBySubagent: Story = { args: { sourceTitle: 'Explore repository' } };

export const LongScope: Story = {
  args: {
    request: {
      ...request,
      patterns: [
        'git push origin main',
        'git push origin feature/a-very-long-branch-name',
        'git push --force-with-lease origin main',
      ],
      always: ['git push *', 'git fetch *', 'git pull *'],
    },
  },
};
