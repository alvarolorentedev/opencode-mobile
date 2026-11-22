// @vitest-environment happy-dom

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MissionActivityChart } from '@/features/sessions/ui/mission-activity-chart';
import { Skeleton } from '@/shared/ui/skeleton';
import { Text } from '@/shared/ui/text';
import { renderHook } from '../../../tests/helpers/render-hook';
import { textContent } from '../../../tests/helpers/ui.mjs';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: ({ web }: { web?: unknown }) => web },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('@rn-primitives/slot', () => ({ Slot: 'Slot' }));
vi.mock('uniwind', () => ({ Uniwind: {} }));
vi.mock('react-native-chart-kit/v2', () => ({ BarChart: 'BarChart' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }) }));
vi.mock('@/shared/i18n/index', () => ({ getFormatLocale: () => 'en' }));

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
    const props: Parameters<typeof MissionActivityChart>[0] = {
      hours: 24, onRangeChange: () => {}, buckets, checked: 0, total: 2, loading: true,
    };
    const runtime = renderHook(MissionActivityChart, props);
    const layout = find(runtime.result.current, (entry) => typeof entry.props?.onLayout === 'function')[0];
    act(() => layout.props.onLayout({ nativeEvent: { layout: { width: 300, height: 200 } } }));
    expect(find(runtime.result.current, (entry) => entry.type === Skeleton)).toHaveLength(1 + buckets.length);
    expect(find(runtime.result.current, (entry) => entry.props?.testID === 'mission-activity-loading')).toHaveLength(1);
    expect(find(runtime.result.current, (entry) => entry.props?.testID === 'mission-activity-total')).toHaveLength(0);
    expect(find(runtime.result.current, (entry) => entry.type === Text && textContent(entry) === '24h')).toHaveLength(1);

    runtime.rerender({ ...props, loading: false, checked: 1, series: {
      total: { conversations: 2, tokens: 123, cost: 0.1 },
      buckets: buckets.map(() => ({ conversations: 1, tokens: 20, cost: 0.01 })),
    } });
    expect(find(runtime.result.current, (entry) => entry.props?.testID === 'mission-activity-loading')).toHaveLength(0);
    expect(find(runtime.result.current, (entry) => entry.props?.testID === 'mission-activity-total')).toHaveLength(1);
    expect(find(runtime.result.current, (entry) => entry.type === 'BarChart')[0].props).toMatchObject({ width: 300, height: 200 });
    expect(find(runtime.result.current, (entry) => entry.type === Text && textContent(entry) === 'mission.activityPartial')).toHaveLength(1);

    runtime.rerender({ ...props, checked: 1, loading: false, series: undefined });
    expect(find(runtime.result.current, (entry) => entry.type === Text && textContent(entry) === 'mission.activityUnavailable')).toHaveLength(1);
    runtime.unmount();
  });
});
