import { textContent, uiImports } from '../../../tests/helpers/ui.mjs';
import { describe, expect, it } from 'vitest';
import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

async function render(detail: Record<string, unknown>) {
  const runtime = hookRuntime();
  const element = (type: unknown, props: unknown) => ({ type, props });
  const { CompactionDivider } = await loadTs('features/chat/ui/cards/compaction-divider.tsx', {
    ...uiImports,
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'react-i18next': {
      useTranslation: () => ({
        t: (key: string, options?: { input?: string; output?: string }) => options ? `${key}:${options.input}/${options.output}` : key,
      }),
    },
    'react-native': { View: 'View' },
    "@/shared/ui/theme/theme": { Colors: { light: {} } }
  }, runtime.globals);
  return textContent(runtime.mount(CompactionDivider, {
    detail,
    palette: { border: '#eee', muted: '#888' },
  }));
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
