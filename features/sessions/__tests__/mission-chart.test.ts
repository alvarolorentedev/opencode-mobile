import { uiImports, textContent } from '../../../tests/helpers/ui.mjs';
import { describe, expect, it } from 'vitest';

import { hookRuntime, loadTs } from '../../../tests/helpers/runtime.mjs';

type Element = { type: unknown; props: any };

function find(node: unknown, predicate: (element: Element) => boolean, out: Element[] = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => find(child, predicate, out));
    return out;
  }
  const element = node as Element;
  if (predicate(element)) out.push(element);
  if (element.props?.children !== undefined) find(element.props.children, predicate, out);
  return out;
}

const buckets = Array.from({ length: 6 }, (_, index) => ({ from: index * 3_600_000, to: (index + 1) * 3_600_000 }));

describe('Mission activity chart', () => {
  it('holds the chart layout with a skeleton while statistics load and warns when coverage is incomplete', async () => {
    const runtime = hookRuntime();
    const element = (type: unknown, props: unknown) => ({ type, props });
    const { MissionActivityChart } = await loadTs('features/sessions/ui/mission-activity-chart.tsx', {
      ...uiImports,
      react: runtime.react,
      'react/jsx-runtime': { jsx: element, jsxs: element },
      'react-native': { Platform: { OS: 'web' }, Pressable: 'Pressable', View: 'View' },
      'react-i18next': { useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }) },
      '@/features/sessions/model/mission-stats': { MISSION_STATS_RANGES: [{ hours: 24, buckets: 6 }] },
      '@/shared/presentation/format': { formatMessageTime: String, formatTimestamp: String },
      '@/shared/presentation/usage': { formatEstimatedCost: String, formatTokenCount: String },
      '@/shared/ui/skeleton': { Skeleton: 'Skeleton' },
    }, runtime.globals);

    runtime.mount(MissionActivityChart, { hours: 24, onRangeChange: () => {}, buckets, checked: 0, total: 2, loading: true });
    expect(find(runtime.value, (entry) => entry.type === 'Skeleton')).toHaveLength(4 + buckets.length);
    expect(find(runtime.value, (entry) => entry.props?.testID === 'mission-activity-loading')).toHaveLength(1);
    expect(find(runtime.value, (entry) => entry.props?.testID === 'mission-activity-total')).toHaveLength(0);

    runtime.update({ loading: false, checked: 1, series: {
      total: { conversations: 2, tokens: 123, cost: 0.1 },
      buckets: buckets.map(() => ({ conversations: 1, tokens: 20, cost: 0.01 })),
    } });
    expect(find(runtime.value, (entry) => entry.props?.testID === 'mission-activity-loading')).toHaveLength(0);
    expect(find(runtime.value, (entry) => entry.props?.testID === 'mission-activity-total')).toHaveLength(1);
    expect(find(runtime.value, (entry) => entry.type === 'Text' && textContent(entry) === 'mission.activityPartial')).toHaveLength(1);

    runtime.update({ loading: false, series: undefined });
    expect(find(runtime.value, (entry) => entry.type === 'Text' && textContent(entry) === 'mission.activityUnavailable')).toHaveLength(1);
    runtime.unmount();
  });
});
