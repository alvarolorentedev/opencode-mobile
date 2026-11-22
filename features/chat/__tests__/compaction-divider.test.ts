// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import { CompactionDivider } from '@/features/chat/ui/cards/compaction-divider';
import { Colors } from '@/shared/ui/theme/theme';
import { renderHook } from '../../../tests/helpers/render-hook';
import { textContent } from '../../../tests/helpers/text-content';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { input?: string; output?: string }) => options ? `${key}:${options.input}/${options.output}` : key,
  }),
}));
vi.mock('@/shared/i18n/index', () => ({ getFormatLocale: () => 'en' }));
vi.mock('react-native', () => ({ Platform: { OS: 'web', select: ({ web }: { web?: unknown }) => web }, Text: 'Text', View: 'View' }));
vi.mock('@rn-primitives/slot', () => ({ Slot: 'Slot' }));

function render(detail: Parameters<typeof CompactionDivider>[0]['detail']) {
  const { result } = renderHook(CompactionDivider, { detail, palette: Colors.light });
  return textContent(result.current);
}

describe('compaction divider', () => {
  it('labels the running and failed states', async () => {
    expect(await render({ id: 'c1', kind: 'compaction', status: 'running' })).toContain('chat:compaction.started');
    expect(await render({ id: 'c2', kind: 'compaction', status: 'failed' })).toContain('chat:compaction.failed');
  });

  it('appends compacted token totals when the server reported usage', async () => {
    const text = await render({ id: 'c3', kind: 'compaction', status: 'completed', inputTokens: 97_300, outputTokens: 858 });
    expect(text).toContain('chat:compaction.completed');
    expect(text).toContain('chat:compaction.usage:97.3K/858');
  });
});
