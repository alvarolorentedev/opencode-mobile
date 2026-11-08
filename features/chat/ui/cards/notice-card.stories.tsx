import type { Meta, StoryObj } from '@storybook/react-vite';
import type { TranscriptEntry } from '@/shared/presentation/format';
import { NoticeCard } from './notice-card';

const entry: TranscriptEntry = {
  id: 'notice-quota',
  role: 'assistant',
  notice: true,
  noticeKind: 'plugin',
  createdAt: Date.now(),
  text: '[OpenCode Quota report]\nQuota · 7 days · $0.05 · 2.41B tokens\n- OpenAI (Plus) 7d 100% left $0.05\n- OpenCode Go 5h 100% left · 7d 57% left · 30d 28% left no price\n- OpenCode Zen 30d $25.62 used · Balance $0.00 left no price\n[End of OpenCode Quota report]',
  details: [],
};

const meta = {
  title: 'Chat/Notice card',
  component: NoticeCard,
  args: { entry, fontSize: 16, onCopy: () => undefined },
} satisfies Meta<typeof NoticeCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Copied: Story = { args: { copied: true } };

export const Flat: Story = { args: { flat: true } };

export const Slim: Story = { args: { slim: true } };

export const LongReport: Story = {
  args: {
    entry: {
      ...entry,
      text: [
        '[OpenCode Quota report]',
        'Quota · 7 days · $0.05 · 2.41B tokens',
        '- OpenAI (Plus) 7d 100% left $0.05',
        '- OpenCode Go 5h 100% left · 7d 57% left · 30d 28% left no price',
        '- OpenCode Zen 30d $25.62 used · Balance $0.00 left no price',
        '- Anthropic (Claude) 5h 84% left · 7d 63% left · 30d 41% left $12.40',
        '- Google Gemini 5h 100% left · 7d 100% left · 30d 92% left no price',
        '[End of OpenCode Quota report]',
      ].join('\n'),
    },
  },
};

export const Error: Story = {
  args: {
    entry: {
      ...entry,
      text: '',
      error: 'The quota report could not be read.',
    },
  },
};
