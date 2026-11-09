import type { Meta, StoryObj } from '@storybook/react-vite';
import { View } from 'react-native';
import { MissionSessionRow, MissionSummary } from '@/features/sessions/ui/mission-cards';
import { MissionActivityChart } from '@/features/sessions/ui/mission-activity-chart';
import type { MissionRow } from '@/features/sessions/model/mission-control';
import { missionStatsBuckets } from '@/features/sessions/model/mission-stats';

const row: MissionRow = {
  key: 'billing', target: { connectionId: 'studio', projectPath: '/billing/fix-sync', sessionId: 'billing' },
  title: 'Fix billing sync', server: 'Studio', project: 'Billing', projectKey: 'studio/billing', worktree: 'fix-sync',
  updatedAt: Date.now() - 120_000, status: 'attention', permission: true, question: true, retrying: false, stale: false,
};

const meta = { title: 'Sessions/Mission Control', component: MissionSessionRow, args: { row, onOpen: () => undefined },
  decorators: [(Story) => <View className="w-80 bg-background p-3"><Story /></View>] } satisfies Meta<typeof MissionSessionRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NeedsAttention: Story = {};
export const LastKnown: Story = { args: { row: { ...row, status: 'unknown', stale: true, permission: false, question: false }, error: true } };
export const Counts: Story = { render: () => <MissionSummary counts={{ attention: 2, running: 3, failed: 1, completed: 4 }}
  onOpen={() => undefined} /> };
const chart = { hours: 24 as const, buckets: missionStatsBuckets(24, Date.now()), total: 4, loading: false, onRangeChange: () => undefined };
export const Activity: Story = { render: () => <MissionActivityChart {...chart} checked={3} series={{
  total: { conversations: 12, tokens: 128_400, cost: 0.12 },
  buckets: [8_400, 18_000, 12_000, 24_000, 36_000, 30_000].map((tokens) => ({ conversations: 4, tokens, cost: 0.02 })),
}} /> };
export const ActivityUnavailable: Story = { render: () => <MissionActivityChart {...chart} checked={0} /> };
